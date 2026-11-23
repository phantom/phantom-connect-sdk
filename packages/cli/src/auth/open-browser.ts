import { execFile } from "child_process";
import * as path from "path";

export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onExit = (error: Error | null) => (error ? reject(error) : resolve());
    if (process.platform === "win32") {
      // Keep the URL out of PowerShell syntax, including its smart-quote delimiters.
      const command = "Start-Process -FilePath $env:PHANTOM_BROWSER_URL";
      const powershell = path.win32.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      execFile(
        powershell,
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
        { windowsHide: true, env: { ...process.env, PHANTOM_BROWSER_URL: url } },
        onExit,
      );
    } else {
      execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], onExit);
    }
  });
}
