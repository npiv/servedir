import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sections = [
  "THIRD-PARTY NOTICES\n\nservedir embeds the following open-source components. This file is also available with servedir --licenses.\n",
];
const paths = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .slice(1);
const seen = new Set();
for (const dir of paths.sort()) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const licenses = readdirSync(dir).filter((name) =>
    /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name),
  );
  const text = licenses
    .map((name) => {
      try {
        return `${name}\n\n${readFileSync(join(dir, name), "utf8")}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
  sections.push(
    `${"=".repeat(72)}\n${key}\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license || pkg.licenses || "See upstream project")}\n${pkg.homepage || ""}\n\n${text || "See the upstream package for its license text."}`,
  );
}
let go = ["go"];
try {
  execFileSync("go", ["version"], { stdio: "ignore" });
} catch {
  go = ["mise", "exec", "go@latest", "--", "go"];
}
execFileSync(go[0], [...go.slice(1), "mod", "download"], { stdio: "ignore" });
const module = JSON.parse(
  execFileSync(
    go[0],
    [...go.slice(1), "list", "-m", "-json", "golang.org/x/sys"],
    { encoding: "utf8" },
  ),
);
sections.push(
  `${"=".repeat(72)}\n${module.Path}@${module.Version}\n\n${readFileSync(join(module.Dir, "LICENSE"), "utf8")}`,
);
const goroot = execFileSync(go[0], [...go.slice(1), "env", "GOROOT"], {
  encoding: "utf8",
}).trim();
sections.push(
  `${"=".repeat(72)}\nGo runtime and standard library\n\n${readFileSync(join(goroot, "LICENSE"), "utf8")}`,
);
writeFileSync("THIRD_PARTY_NOTICES.txt", sections.join("\n\n") + "\n");
console.log(
  `Collected notices for ${seen.size} JavaScript packages, Go, and golang.org/x/sys.`,
);
