import { execFile } from "child_process";
import { openBrowser } from "./open-browser";

jest.mock("child_process", () => ({ execFile: jest.fn() }));

const mockExecFile = execFile as unknown as jest.Mock;
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const systemRoot = process.env.SystemRoot;
const browserUrl = process.env.PHANTOM_BROWSER_URL;
const windowsIt = process.platform === "win32" ? it : it.skip;

beforeEach(() => {
  process.env.SystemRoot = "C:\\Windows";
});

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  if (systemRoot === undefined) {
    delete process.env.SystemRoot;
  } else {
    process.env.SystemRoot = systemRoot;
  }
  if (browserUrl === undefined) {
    delete process.env.PHANTOM_BROWSER_URL;
  } else {
    process.env.PHANTOM_BROWSER_URL = browserUrl;
  }
  jest.resetAllMocks();
});

it("preserves all device authorization parameters in the Windows launch command", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  mockExecFile.mockImplementation((...args) => args.at(-1)(null));
  const url =
    "https://connect.phantom.app/device-connect?user_code=ABCD-1234&client_id=client%20id&public_key=key%2Bvalue";

  await openBrowser(url);

  expect(mockExecFile).toHaveBeenCalledTimes(1);
  const [command, args, options] = mockExecFile.mock.calls[0];
  expect(command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  expect(options).toEqual({
    windowsHide: true,
    env: { ...process.env, PHANTOM_BROWSER_URL: url },
  });
  expect(args.slice(0, -1)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  expect(Buffer.from(args.at(-1), "base64").toString("utf16le")).toBe(
    "Start-Process -FilePath $env:PHANTOM_BROWSER_URL",
  );
});

it.each([
  "https://example.test/team’s/device-connect?user_code=ABCD&client_id=client&public_key=key",
  "https://example.test/it's?value=$(echo hello)&percent=%PATH%&tick=`test",
  'https://example.test/‘’“”?value="double quotes"&delayed=!PATH!',
  "https://example.test/login?literal=$env:PHANTOM_BROWSER_URL",
])("passes the Windows URL unchanged as data: %s", async url => {
  Object.defineProperty(process, "platform", { value: "win32" });
  mockExecFile.mockImplementation((...args) => args.at(-1)(null));
  const previousUrl = process.env.PHANTOM_BROWSER_URL;

  await openBrowser(url);

  const [, args, options] = mockExecFile.mock.calls[0];
  expect(Buffer.from(args.at(-1), "base64").toString("utf16le")).toBe(
    "Start-Process -FilePath $env:PHANTOM_BROWSER_URL",
  );
  expect(options.env.PHANTOM_BROWSER_URL).toBe(url);
  expect(process.env.PHANTOM_BROWSER_URL).toBe(previousUrl);
});

it("overrides an inherited browser URL only in the child process", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  mockExecFile.mockImplementation((...args) => args.at(-1)(null));
  process.env.PHANTOM_BROWSER_URL = "https://example.test/stale";
  const url = "https://example.test/device-connect?user_code=ABCD&client_id=client&public_key=key";

  await openBrowser(url);

  expect(mockExecFile.mock.calls[0][2].env.PHANTOM_BROWSER_URL).toBe(url);
  expect(process.env.PHANTOM_BROWSER_URL).toBe("https://example.test/stale");
});

it.each([
  [undefined, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
  ["D:\\Windows", "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
])("uses system PowerShell when SystemRoot is %s", async (root, executable) => {
  Object.defineProperty(process, "platform", { value: "win32" });
  if (root === undefined) {
    delete process.env.SystemRoot;
  } else {
    process.env.SystemRoot = root;
  }
  mockExecFile.mockImplementation((...args) => args.at(-1)(null));

  await openBrowser("https://example.test/login");

  expect(mockExecFile.mock.calls[0][0]).toBe(executable);
});

windowsIt("passes a smart-quote URL to Start-Process as one unchanged argument in Windows PowerShell", async () => {
  if (systemRoot !== undefined) {
    process.env.SystemRoot = systemRoot;
  }
  mockExecFile.mockImplementation((...args) => args.at(-1)(null));
  const url = "https://example.test/team’s/device-connect?user_code=ABCD&client_id=client%20id&public_key=key";
  await openBrowser(url);

  const [executable, args, options] = mockExecFile.mock.calls[0];
  const command = Buffer.from(args.at(-1), "base64").toString("utf16le");
  const capture =
    "function Start-Process { param([string]$FilePath) if ($args.Count -ne 0) { throw 'Unexpected arguments' }; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($FilePath)) }; ";
  const { execFileSync } = jest.requireActual<typeof import("child_process")>("child_process");
  const output = execFileSync(
    executable,
    [...args.slice(0, -1), Buffer.from(capture + command, "utf16le").toString("base64")],
    { ...options, encoding: "utf8", timeout: 10000 },
  );

  expect(Buffer.from(output.trim(), "base64").toString("utf8")).toBe(url);
});

it.each([
  ["darwin", "open"],
  ["linux", "xdg-open"],
])("passes the full URL directly to the browser launcher on %s", async (os, command) => {
  Object.defineProperty(process, "platform", { value: os });
  mockExecFile.mockImplementation((...args) => args.at(-1)(null));
  const url = "https://example.test/login?client_id=client&public_key=key";

  await openBrowser(url);

  expect(mockExecFile).toHaveBeenCalledWith(command, [url], expect.any(Function));
});

it.each(["win32", "darwin", "linux"])("rejects launcher errors on %s", async os => {
  Object.defineProperty(process, "platform", { value: os });
  const error = new Error("Browser launcher failed");
  mockExecFile.mockImplementation((...args) => args.at(-1)(error));

  await expect(openBrowser("https://example.test/login")).rejects.toBe(error);
});
