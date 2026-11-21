using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32;

internal static class Installer
{
    private const string Product = "Nagisa Desktop Pet";
    private const string ProductId = "WMXhy.NagisaDesktopPet";
    private const string Exe = Product + ".exe";
    private const string Marker = ".nagisa-install";
    private const string State = @"Software\WMXhy\NagisaDesktopPet";
    private const string Uninstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";
    private const string Run = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Approval = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    private const string LoginName = "NagisaDesktopPet";
    private const string ScratchPrefix = ".nagisa-txn-";
    private static readonly string Local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string UserData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Product);
    private static readonly string LegacyRoot = Path.Combine(Local, "nagisa_app");
    private static readonly string Shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product + ".lnk");
    private static readonly StringComparer Paths = StringComparer.OrdinalIgnoreCase;

    private sealed class Catalog
    {
        public string Version;
        public string[] Files;
        public IEnumerable<string> Managed { get { return Files.Concat(new[] { Marker }); } }
    }

    private sealed class Transaction
    {
        public string Target, Work, Previous, Legacy, Login, Phase;
        public string Stage { get { return Path.Combine(Work, "stage"); } }
        public string Backup { get { return Path.Combine(Work, "backup"); } }
        public string NewCatalog { get { return Path.Combine(Work, "new.list"); } }
        public string OldCatalog { get { return Path.Combine(Work, "old.list"); } }
    }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out ushort hotkey);
        void SetHotkey(ushort hotkey);
        void GetShowCmd(out int showCommand);
        void SetShowCmd(int showCommand);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    private static string Value(string key, string name)
    {
        using (var opened = Registry.CurrentUser.OpenSubKey(key))
            return opened == null ? "" : (opened.GetValue(name) as string ?? "");
    }

    private static void Set(string key, string name, string value)
    {
        using (var opened = Registry.CurrentUser.CreateSubKey(key))
        { opened.SetValue(name, value); opened.Flush(); }
    }

    private static bool ContainsPath(string root, string item)
    {
        return Paths.Equals(root, item) || item.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    }

    private static bool Overlaps(string a, string b) { return ContainsPath(a, b) || ContainsPath(b, a); }

    private static void NoLink(string path)
    {
        for (var current = path; !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
        {
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("请选择普通文件夹，安装路径不能经过链接或目录联接。");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
    }

    private static string Absolute(string value)
    {
        if (value.Length < 3 || !Char.IsLetter(value[0]) || value[1] != ':' || value[2] != '\\' ||
            value.Substring(2).IndexOf(':') >= 0)
            throw new IOException("请输入本机磁盘上的完整目录，例如 D:\\游戏。");
        var full = Path.GetFullPath(value).TrimEnd('\\');
        if (full.Length <= 2) throw new IOException("请选择磁盘上的专属文件夹，不能直接安装到盘符根目录。");
        foreach (var part in full.Substring(3).Split('\\'))
            if (part.Length == 0 || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new IOException("目录名称含有 Windows 不支持的字符。");
        NoLink(full);
        return full;
    }

    private static string LocalFile(string root, string relative)
    {
        if (relative.Split('\\').Any(part => part.Length == 0 || part == "." || part == ".." ||
            part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
            throw new IOException("安装清单中有无效的相对路径。");
        var file = Path.Combine(root, relative);
        NoLink(file);
        return file;
    }

    private static Catalog ReadCatalog(string file)
    {
        NoLink(file);
        var lines = File.ReadAllLines(file, Encoding.UTF8);
        Version parsed;
        if (lines.Length < 3 || lines[0] != ProductId || !Version.TryParse(lines[1], out parsed))
            throw new IOException("找不到有效的古河渚桌宠安装清单。");
        var files = lines.Skip(2).ToArray();
        if (files.Distinct(Paths).Count() != files.Length || files.Contains(Marker, Paths) ||
            !files.Contains(Exe, Paths) || !files.Contains("Uninstall.exe", Paths) ||
            !files.Contains(@"resources\app.asar", Paths) || !files.Contains(@"resources\NagisaDesktopState.exe", Paths))
            throw new IOException("桌宠安装清单不完整。");
        return new Catalog { Version = lines[1], Files = files };
    }

    private static string InstalledDirectory()
    {
        var folder = Value(State, "InstallDir");
        if (folder.Length == 0) return "";
        folder = Absolute(folder);
        if (Overlaps(folder, LegacyRoot) || Overlaps(folder, UserData))
            throw new IOException("已登记的安装目录无效。");
        return folder;
    }

    private static string Normalize(string input, string installed)
    {
        var folder = Absolute(input.Trim());
        if (!Paths.Equals(folder, installed) && !Paths.Equals(Path.GetFileName(folder), Product))
            folder = Absolute(Path.Combine(folder, Product));
        return folder;
    }

    private static string Legacy(bool retry = false)
    {
        var command = Value(Uninstall + "nagisa_app", "UninstallString");
        if (command.Length == 0) return "";
        NoLink(LegacyRoot);
        var updater = Path.Combine(LegacyRoot, "Update.exe");
        var version = Value(Uninstall + "nagisa_app", "DisplayVersion");
        Version parsed;
        if (!Paths.Equals(command.Trim(), Quote(updater) + " --uninstall") &&
            !Paths.Equals(command.Trim(), updater + " --uninstall"))
            throw new IOException("旧版卸载入口与桌宠的 Squirrel 安装标识不符。");
        if (!Version.TryParse(version, out parsed) || !File.Exists(LocalFile(LegacyRoot, "Update.exe")) ||
            (!retry && (!File.Exists(LocalFile(LegacyRoot, Exe)) ||
                        !File.Exists(LocalFile(LegacyRoot, "app-" + version + "\\" + Exe)) ||
                        !File.Exists(LocalFile(LegacyRoot, @"packages\RELEASES")))))
            throw new IOException("旧版 Squirrel 安装不完整。请检查旧版后重试。");
        if (!retry && !File.ReadLines(LocalFile(LegacyRoot, @"packages\RELEASES"))
            .Any(line => line.Split(' ').Any(field => Paths.Equals(field, "nagisa_app-" + version + "-full.nupkg"))))
            throw new IOException("旧版的安装包标识与古河渚桌宠不匹配。");
        return LegacyRoot;
    }

    private static void RequireClosed()
    {
        var session = Process.GetCurrentProcess().SessionId;
        foreach (var process in Process.GetProcessesByName(Product))
        {
            using (process)
            {
                if (process.SessionId == session && !process.HasExited)
                    throw new IOException("桌宠正在运行。请在系统托盘选择「退出桌宠」，再重试。");
            }
        }
    }

    private static void Validate(string folder, string installed, long bytes, bool pending)
    {
        if (Overlaps(folder, LegacyRoot) || Overlaps(folder, UserData) ||
            (installed.Length > 0 && !Paths.Equals(folder, installed) && Overlaps(folder, installed)))
            throw new IOException("安装路径不能包含旧版目录或养成存档目录，也不能位于这些目录内部。");
        if (File.Exists(folder)) throw new IOException("目标路径是文件，请改选目录。");
        if (Directory.Exists(folder) && Directory.EnumerateFileSystemEntries(folder).Any() && !pending)
        {
            if (!Paths.Equals(folder, installed) || !File.Exists(Path.Combine(folder, Marker)))
                throw new IOException("目标目录非空且不属于此桌宠，请选择空目录。");
            ReadCatalog(Path.Combine(folder, Marker));
        }
        if (new DriveInfo(Path.GetPathRoot(folder)).AvailableFreeSpace < bytes)
            throw new IOException("目标磁盘可用空间不足，请选择其他磁盘。");
        var parent = folder;
        while (!Directory.Exists(parent)) parent = Path.GetDirectoryName(parent);
        var probe = Path.Combine(parent, ".nagisa-write-" + Guid.NewGuid().ToString("N"));
        using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.DeleteOnClose)) { }
    }

    private static string Quote(string value) { return "\"" + value + "\""; }

    private static string LoginPath()
    {
        var entry = Value(Run, LoginName).Trim();
        return entry.StartsWith("\"") && entry.EndsWith("\"") ? entry.Substring(1, entry.Length - 2) : entry;
    }

    private static string CaptureLogin()
    {
        var path = LoginPath();
        if (!Path.IsPathRooted(path) || !Paths.Equals(Path.GetFileName(path), Exe) || path.IndexOf('"') >= 0)
            return "none";
        using (var approved = Registry.CurrentUser.OpenSubKey(Approval))
        {
            var bytes = approved == null ? null : approved.GetValue(LoginName) as byte[];
            return bytes == null ? "enabled" : Convert.ToBase64String(bytes);
        }
    }

    private static void TransferLogin(Transaction tx)
    {
        if (tx.Login == "none") return;
        Set(Run, LoginName, Quote(Path.Combine(tx.Target, Exe)));
        using (var approval = Registry.CurrentUser.CreateSubKey(Approval))
        {
            if (tx.Login == "enabled") approval.DeleteValue(LoginName, false);
            else approval.SetValue(LoginName, Convert.FromBase64String(tx.Login), RegistryValueKind.Binary);
            approval.Flush();
        }
    }

    private static void RemoveLogin(string exe)
    {
        if (!Paths.Equals(LoginPath(), exe)) return;
        using (var run = Registry.CurrentUser.OpenSubKey(Run, true)) if (run != null) run.DeleteValue(LoginName, false);
        using (var approval = Registry.CurrentUser.OpenSubKey(Approval, true)) if (approval != null) approval.DeleteValue(LoginName, false);
    }

    private static IShellLinkW NewShellLink()
    {
        var shellLinkClass = new Guid("00021401-0000-0000-C000-000000000046");
        return (IShellLinkW)Activator.CreateInstance(Type.GetTypeFromCLSID(shellLinkClass));
    }

    private static string ShortcutTarget(string file)
    {
        var link = NewShellLink();
        try
        {
            ((IPersistFile)link).Load(file, 0);
            var path = new StringBuilder(260);
            link.GetPath(path, path.Capacity, IntPtr.Zero, 0);
            return path.ToString();
        }
        finally { Marshal.FinalReleaseComObject(link); }
    }

    private static void WriteShortcut(string file, string folder)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        var link = NewShellLink();
        try
        {
            var target = Path.Combine(folder, Exe);
            link.SetPath(target);
            link.SetWorkingDirectory(folder);
            link.SetIconLocation(target, 0);
            ((IPersistFile)link).Save(file, true);
        }
        finally { Marshal.FinalReleaseComObject(link); }
    }

    private static void CheckShortcut(string target, string previous)
    {
        if (!File.Exists(Shortcut)) return;
        var path = ShortcutTarget(Shortcut);
        if (!Paths.Equals(path, Path.Combine(target, Exe)) &&
            (previous.Length == 0 || !Paths.Equals(path, Path.Combine(previous, Exe))) &&
            !ContainsPath(LegacyRoot, path))
            throw new IOException("开始菜单已有同名的其他快捷方式，请先检查该入口。");
    }

    private static void WriteEntries(Transaction tx, Catalog catalog)
    {
        CheckShortcut(tx.Target, tx.Previous);
        WriteShortcut(Shortcut, tx.Target);
        TransferLogin(tx);

        using (var key = Registry.CurrentUser.CreateSubKey(Uninstall + ProductId))
        {
            var uninstaller = Quote(Path.Combine(tx.Target, "Uninstall.exe"));
            key.SetValue("DisplayName", Product);
            key.SetValue("DisplayVersion", catalog.Version);
            key.SetValue("DisplayIcon", Quote(Path.Combine(tx.Target, Exe)));
            key.SetValue("InstallLocation", tx.Target);
            key.SetValue("UninstallString", uninstaller);
            key.SetValue("QuietUninstallString", uninstaller + " /S");
            key.SetValue("Publisher", "WMXhy");
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
            key.Flush();
        }
        Set(State, "Version", catalog.Version);
        Set(State, "InstallDir", tx.Target);
    }

    private static Transaction ReadPending()
    {
        var value = Value(State, "Pending");
        if (value.Length == 0) return null;
        var parts = value.Split('\n');
        if (parts.Length != 6 || !new[] { "stage", "rollback", "activate", "cleanup" }.Contains(parts[5]))
            throw new IOException("上次安装的恢复记录无效。");
        var tx = new Transaction { Target = Absolute(parts[0]), Work = Absolute(parts[1]),
            Previous = parts[2].Length == 0 ? "" : Absolute(parts[2]), Legacy = parts[3], Login = parts[4], Phase = parts[5] };
        var name = Path.GetFileName(tx.Work);
        Guid id;
        if (!Paths.Equals(Path.GetDirectoryName(tx.Work), tx.Target) || !name.StartsWith(ScratchPrefix) ||
            !Guid.TryParseExact(name.Substring(ScratchPrefix.Length), "N", out id) ||
            Overlaps(tx.Target, UserData) || Overlaps(tx.Target, LegacyRoot) ||
            (tx.Previous.Length > 0 && (Overlaps(tx.Previous, UserData) || Overlaps(tx.Previous, LegacyRoot) ||
             (!Paths.Equals(tx.Previous, tx.Target) && Overlaps(tx.Previous, tx.Target)))) ||
            (tx.Legacy.Length > 0 && !Paths.Equals(tx.Legacy, LegacyRoot)))
            throw new IOException("上次安装的目录记录无效。");
        return tx;
    }

    private static void WritePending(Transaction tx)
    {
        Set(State, "Pending", String.Join("\n", new[] { tx.Target, tx.Work, tx.Previous, tx.Legacy, tx.Login, tx.Phase }));
    }

    private static IEnumerable<string> ListFiles(string root)
    {
        NoLink(root);
        foreach (var file in Directory.EnumerateFiles(root)) { NoLink(file); yield return file; }
        foreach (var directory in Directory.EnumerateDirectories(root))
            foreach (var file in ListFiles(directory)) yield return file;
    }

    private static void DeleteScratch(string work)
    {
        if (!Directory.Exists(work)) return;
        foreach (var file in ListFiles(work)) File.Delete(file);
        // The private directory contains no reparse points after enumeration.
        Directory.Delete(work, true);
    }

    private static void Move(string from, string to)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(to));
        File.Move(from, to);
    }

    private static void EmptyDirectories(string folder, IEnumerable<string> files)
    {
        foreach (var file in files)
        {
            for (var dir = Path.GetDirectoryName(Path.Combine(folder, file)); ContainsPath(folder, dir); dir = Path.GetDirectoryName(dir))
            {
                NoLink(dir);
                if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
                if (Paths.Equals(dir, folder)) break;
            }
        }
    }

    private static void DeleteOwned(string folder)
    {
        var marker = LocalFile(folder, Marker);
        if (!File.Exists(marker)) return;
        var catalog = ReadCatalog(marker);
        // Resolve every path before deleting any file, including files that a player may have moved.
        foreach (var relative in catalog.Managed) LocalFile(folder, relative);
        foreach (var relative in catalog.Managed)
        {
            var file = LocalFile(folder, relative);
            if (File.Exists(file)) File.Delete(file);
        }
        EmptyDirectories(folder, catalog.Managed);
    }

    private static void Rollback(Transaction tx)
    {
        var incoming = ReadCatalog(tx.NewCatalog);
        foreach (var relative in incoming.Managed)
        {
            var staged = LocalFile(tx.Stage, relative);
            var current = LocalFile(tx.Target, relative);
            if (!File.Exists(staged) && File.Exists(current)) Move(current, staged);
        }
        if (File.Exists(tx.OldCatalog))
            foreach (var relative in ReadCatalog(tx.OldCatalog).Managed)
            {
                var backup = LocalFile(tx.Backup, relative);
                if (File.Exists(backup)) Move(backup, LocalFile(tx.Target, relative));
            }
        EmptyDirectories(tx.Target, incoming.Managed);
    }

    private static void RetireLegacy(Transaction tx)
    {
        if (tx.Legacy.Length == 0 || Value(Uninstall + "nagisa_app", "UninstallString").Length == 0) return;
        if (!Paths.Equals(Legacy(true), tx.Legacy)) throw new IOException("无法核实旧安装的卸载入口。");
        var updater = Path.Combine(tx.Legacy, "Update.exe");
        using (var proc = Process.Start(new ProcessStartInfo(updater, "--uninstall --silent") {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Local }))
        {
            if (!proc.WaitForExit(120000) || proc.ExitCode != 0 ||
                Value(Uninstall + "nagisa_app", "UninstallString").Length != 0)
                throw new IOException("新程序已写入，旧版卸载还未完成。请稍后运行 Setup 重试。");
        }
    }

    private static void Finish(Transaction tx)
    {
        if (tx.Phase == "rollback") Rollback(tx);
        else if (tx.Phase == "activate")
        {
            var catalog = ReadCatalog(LocalFile(tx.Target, Marker));
            foreach (var relative in catalog.Files)
                if (!File.Exists(LocalFile(tx.Target, relative))) throw new IOException("新安装的程序文件不完整。");
            CheckShortcut(tx.Target, tx.Previous);
            RetireLegacy(tx);
            WriteEntries(tx, catalog);
            if (tx.Previous.Length > 0 && !Paths.Equals(tx.Previous, tx.Target)) DeleteOwned(tx.Previous);
        }
        tx.Phase = "cleanup";
        WritePending(tx);
        DeleteScratch(tx.Work);
        EmptyDirectories(tx.Target, new[] { Marker });
        Set(State, "Pending", "");
    }

    private static bool SameFile(string first, string second)
    {
        using (var sha = SHA256.Create())
        using (var a = File.OpenRead(first))
        using (var b = File.OpenRead(second))
            return a.Length == b.Length && sha.ComputeHash(a).SequenceEqual(sha.ComputeHash(b));
    }

    private static void Install(string folder, string payload, string version, long size)
    {
        RequireClosed();
        var pending = ReadPending();
        if (pending != null)
        {
            if (!Paths.Equals(pending.Target, folder)) throw new IOException("请先完成上次未结束的安装。");
            var wasActivating = pending.Phase == "activate";
            Finish(pending);
            if (wasActivating && ReadCatalog(Path.Combine(folder, Marker)).Version == version) return;
        }
        var previous = InstalledDirectory();
        Validate(folder, previous, size, false);
        var legacy = Legacy();
        CheckShortcut(folder, previous);
        var previousMarker = previous.Length == 0 ? "" : Path.Combine(previous, Marker);
        var oldCatalog = File.Exists(previousMarker) ? ReadCatalog(previousMarker) : null;
        if (oldCatalog != null && Version.Parse(oldCatalog.Version) > Version.Parse(version))
            throw new IOException("当前已安装更新版本，请使用较新的 Setup。");
        var replacing = oldCatalog != null && Paths.Equals(previous, folder);
        var tx = new Transaction { Target = folder, Work = Path.Combine(folder, ScratchPrefix + Guid.NewGuid().ToString("N")),
            Legacy = legacy, Previous = previous, Login = CaptureLogin(), Phase = "stage" };
        try
        {
            WritePending(tx);
            Directory.CreateDirectory(tx.Stage);
            var incoming = ListFiles(payload).Select(file => file.Substring(payload.Length + 1)).ToArray();
            File.WriteAllLines(tx.NewCatalog, new[] { ProductId, version }.Concat(incoming), Encoding.UTF8);
            var catalog = ReadCatalog(tx.NewCatalog);
            if (replacing) File.Copy(previousMarker, tx.OldCatalog);
            var owned = new HashSet<string>(replacing ? oldCatalog.Managed : Enumerable.Empty<string>(), Paths);
            foreach (var relative in catalog.Managed)
            {
                var destination = LocalFile(folder, relative);
                if (Directory.Exists(destination) || (File.Exists(destination) && !owned.Contains(relative)))
                    throw new IOException("新文件会覆盖已有内容，请移开此文件后重试。 " + destination);
                var from = relative == Marker ? tx.NewCatalog : LocalFile(payload, relative);
                var stage = LocalFile(tx.Stage, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(stage));
                File.Copy(from, stage);
                if (!SameFile(from, stage)) throw new IOException("写入后校验文件失败。 " + relative);
            }

            tx.Phase = "rollback";
            WritePending(tx);
            if (replacing)
                foreach (var relative in oldCatalog.Managed)
                {
                    var current = LocalFile(folder, relative);
                    if (File.Exists(current)) Move(current, LocalFile(tx.Backup, relative));
                }
            foreach (var relative in catalog.Managed) Move(LocalFile(tx.Stage, relative), LocalFile(folder, relative));
            tx.Phase = "activate";
            WritePending(tx);
            Finish(tx);
        }
        catch
        {
            var stored = ReadPending();
            if (stored == null) { DeleteScratch(tx.Work); EmptyDirectories(folder, new[] { Marker }); }
            else if (stored.Phase == "stage" || stored.Phase == "rollback") Finish(stored);
            throw;
        }
    }

    private static void UninstallApplication(string folder)
    {
        RequireClosed();
        var pending = ReadPending();
        if (pending != null) Finish(pending);
        if (!Paths.Equals(folder, InstalledDirectory())) throw new IOException("此位置不是当前登记的桌宠安装目录。");
        var exe = Path.Combine(folder, Exe);
        ReadCatalog(LocalFile(folder, Marker));
        DeleteOwned(folder);
        if (File.Exists(Shortcut) && Paths.Equals(ShortcutTarget(Shortcut), exe)) File.Delete(Shortcut);
        RemoveLogin(exe);
        Registry.CurrentUser.DeleteSubKeyTree(Uninstall + ProductId, false);
        Registry.CurrentUser.DeleteSubKeyTree(State, false);
    }

    private static void Respond(string file, string folder, string legacy, string message)
    {
        File.WriteAllLines(file, new[] { "[Result]", "directory=" + folder, "legacy=" + legacy,
            "message=" + message.Replace('\r', ' ').Replace('\n', ' ') }, Encoding.Unicode);
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 2) return 2;
        var result = args[args.Length - 1];
        try
        {
            using (var mutex = new Mutex(false, @"Local\WMXhy.NagisaDesktopPet.Setup"))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("桌宠安装或卸载正在进行，请稍候。");
                try
                {
                    var previous = InstalledDirectory();
                    var pending = ReadPending();
                    switch (args[0])
                    {
                        case "info":
                            var preferred = pending != null ? pending.Target : previous;
                            Respond(result, preferred, pending != null ? pending.Legacy : Legacy(), "");
                            break;
                        case "validate":
                            RequireClosed();
                            var selected = Normalize(args[1], previous);
                            if (pending != null && !Paths.Equals(pending.Target, selected))
                                throw new IOException("请先使用上次选择的目录恢复安装。");
                            var bytes = Int64.Parse(args[2], CultureInfo.InvariantCulture);
                            var tempDrive = new DriveInfo(Path.GetPathRoot(result));
                            if (tempDrive.AvailableFreeSpace < bytes)
                                throw new IOException("Windows 临时目录所在的磁盘空间不足。请腾出空间再试。");
                            var required = Paths.Equals(tempDrive.Name, Path.GetPathRoot(selected)) ? bytes * 2 : bytes;
                            Validate(selected, previous, pending != null ? 0 : required, pending != null);
                            Respond(result, selected, "", "");
                            break;
                        case "install":
                            var target = Normalize(args[1], previous);
                            Install(target, args[2], args[3], Int64.Parse(args[4], CultureInfo.InvariantCulture));
                            Respond(result, target, "", "");
                            break;
                        case "uninstall":
                            UninstallApplication(Absolute(args[1]));
                            Respond(result, "", "", "");
                            break;
                        default: return 2;
                    }
                }
                finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
        catch (Exception error)
        {
            var message = error is UnauthorizedAccessException ? "无法写入或修改所选目录，请选择可写的目录后重试。" : error.Message;
            Respond(result, "", "", message);
            return 1;
        }
    }
}
