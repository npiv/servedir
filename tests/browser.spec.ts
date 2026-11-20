import { test, expect } from "@playwright/test";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

let root: string;
let server: ChildProcess;
let baseURL: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "servedir-browser-"));
  await cp("examples/project", root, { recursive: true });
  await writeFile(join(root, ".secret-note"), "hidden but available");
  await writeFile(
    join(root, "space # café.md"),
    "# Unicode works\n\nSpaces, hashes, and accents.",
  );
  await writeFile(join(root, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1));
  await writeFile(
    join(root, "broken.md"),
    "# Safe rendering\n\n<script>window.pwned=true</script>\n\n```mermaid\nthis is not a diagram\n```\n\n[Unsafe](javascript:alert(1))",
  );
  server = spawn("./bin/servedir", ["--port", "0", root], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  baseURL = await new Promise<string>((resolve, reject) => {
    let output = "";
    server.stdout!.on("data", (data) => {
      output += data.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    server.on("error", reject);
    server.on("exit", (code) =>
      reject(new Error(`Server exited with ${code}`)),
    );
  });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill("SIGINT");
    });
  }
  await rm(root, { recursive: true, force: true });
});

test("browses, filters, sorts and exposes truthful metadata", async ({
  page,
}) => {
  await page.goto(baseURL);
  await expect(
    page.getByRole("columnheader", { name: "Created" }),
  ).toBeVisible();
  await expect(page.locator("#file-rows tr").first()).toContainText("notes");
  await expect(page.locator("#file-rows")).not.toContainText(".secret-note");
  await page.getByRole("button", { name: "Hidden files" }).click();
  await expect(page.locator("#file-rows")).toContainText(".secret-note");
  await page.getByRole("button", { name: "Hidden files" }).click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("searchbox").fill("readme");
  await expect(page.locator("#file-rows tr")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Size", exact: true }).click();
  await expect(page.locator("#file-rows tr").first()).toContainText("notes");
  await page.getByRole("button", { name: "Size", exact: true }).click();
  await expect(page.locator("#file-rows tr").nth(1)).toContainText("large.txt");
  await page.getByRole("button", { name: /^Documents/ }).click();
  await expect(page.locator("#file-rows")).not.toContainText("settings.json");
  await page.getByRole("button", { name: /^All files/ }).click();
  await page.screenshot({ path: "test-results/directory.png", fullPage: true });
});

test("renders Markdown, Mermaid, local images and relative document links offline", async ({
  page,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith(baseURL)) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(baseURL + "/?path=README.md");
  await expect(
    page.getByRole("heading", { name: "A place for your next idea" }),
  ).toBeVisible();
  await expect(page.locator(".diagram-output svg")).toBeVisible();
  await expect(page.locator(".diagram-output")).toContainText("Your folder");
  await expect(page.locator(".markdown-body img")).toHaveJSProperty(
    "naturalWidth",
    1000,
  );
  await page.screenshot({ path: "test-results/markdown.png", fullPage: true });
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator(".source-code")).toContainText("```mermaid");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator(".diagram-output svg")).toBeVisible();
  await page.getByRole("link", { name: "the field notes" }).click();
  await expect(
    page.getByRole("heading", { name: "Field notes", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".diagram-output svg")).toBeVisible();
  await expect(page.locator(".markdown-body img")).toHaveJSProperty(
    "naturalWidth",
    1000,
  );
  await page.getByRole("link", { name: "Back to the workspace" }).click();
  await expect(page).toHaveURL(/#made-for-local-work$/);
  await expect(
    page.getByRole("heading", { name: "Made for local work" }),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("supports image, code, downloads and encoded filenames", async ({
  page,
}) => {
  await page.goto(baseURL + "/?path=landscape.svg");
  await expect(page.locator(".image-preview img")).toHaveJSProperty(
    "naturalWidth",
    1000,
  );
  await page.goto(baseURL + "/?path=settings.json");
  await expect(page.locator(".source-code")).toContainText("readOnly");
  await expect(page.locator(".source-code .hljs-attr").first()).toBeVisible();
  await page.goto(baseURL + "/?path=" + encodeURIComponent("space # café.md"));
  await expect(
    page.getByRole("heading", { name: "Unicode works" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("space # café.md");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("handles malformed diagrams, raw HTML, and large files", async ({
  page,
}) => {
  await page.goto(baseURL + "/?path=broken.md");
  await expect(page.locator(".diagram-error")).toBeVisible();
  await expect(page.locator(".mermaid-source")).toContainText(
    "this is not a diagram",
  );
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  await expect(
    page.locator('.markdown-body a[href^="javascript:"]'),
  ).toHaveCount(0);
  await page.goto(baseURL + "/?path=large.txt");
  await expect(page.getByText(/2 MiB text preview limit/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download file" })).toBeVisible();
});

test("fits a phone and keeps theme across navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL);
  await expect(page.getByRole("searchbox")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.goto(baseURL + "/?path=README.md");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".diagram-output svg")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-dark.png",
    fullPage: true,
  });
});
