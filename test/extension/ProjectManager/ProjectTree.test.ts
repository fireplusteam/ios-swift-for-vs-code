import * as assert from "assert";
import * as path from "path";
import { ProjectTree } from "../../../src/ProjectManager/ProjectTree";

suite("ProjectTree Test Suite", () => {
    let projectTree: ProjectTree;

    setup(() => {
        projectTree = new ProjectTree();
    });

    suite("Constructor", () => {
        test("should create instance successfully", () => {
            assert.ok(projectTree instanceof ProjectTree);
        });

        test("should initialize with empty excluded files", () => {
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [""]);
        });
    });

    suite("addIncluded", () => {
        test("should add single file path", () => {
            projectTree.addIncluded("src/test.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should add nested file path", () => {
            projectTree.addIncluded("src/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should add multiple included paths", () => {
            projectTree.addIncluded("src/file1.ts");
            projectTree.addIncluded("src/file2.ts");
            projectTree.addIncluded("src/file3.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should handle includeSubfolders=true (default)", () => {
            projectTree.addIncluded("src/components");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should handle includeSubfolders=false", () => {
            projectTree.addIncluded("src/components", false);
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should ignore single component paths", () => {
            projectTree.addIncluded("src/");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, []);
        });

        test("should ignore empty paths", () => {
            projectTree.addIncluded("");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [""]);
        });

        test("should handle deeply nested paths", () => {
            projectTree.addIncluded("a/b/c/d/e/f/g/h/i/j/file.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });
    });

    suite("addExcluded", () => {
        test("should exclude single file", () => {
            projectTree.addIncluded("src/root/");
            projectTree.addExcluded("src/root/test.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/root/test.ts"]);
        });

        test("should exclude nested with root file", () => {
            projectTree.addIncluded("scr/");
            projectTree.addExcluded("src/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src"]);
        });

        test("should exclude nested file", () => {
            projectTree.addIncluded("scr/");
            projectTree.addIncluded("scr/components/");
            projectTree.addExcluded("src/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src"]);
        });

        test("should exclude multiple files", () => {
            projectTree.addIncluded("src/");
            projectTree.addExcluded("src/file1.ts");
            projectTree.addExcluded("src/file2.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/{file1.ts,file2.ts}"]);
        });

        test("should exclude entire directory", () => {
            projectTree.addIncluded("node_modules/");
            projectTree.addExcluded("node_modules/package");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["node_modules/package"]);
        });

        test("should ignore single component paths", () => {
            projectTree.addExcluded("src");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [""]);
        });

        test("should ignore empty paths", () => {
            projectTree.addExcluded("");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [""]);
        });
    });

    suite("Mixed Include/Exclude Operations, should not exclude included files", () => {
        test("should include file then can not exclude it", () => {
            projectTree.addIncluded("src/test.ts");
            projectTree.addExcluded("src/test.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, []);
        });

        test("should exclude file with multiple includes", () => {
            projectTree.addIncluded("src/test.ts");
            projectTree.addIncluded("src/test1.ts");
            projectTree.addIncluded("src/root/test3.ts");
            projectTree.addExcluded("src/test2.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/test2.ts"]);
        });

        test("should include parent folder and exclude child file", () => {
            projectTree.addIncluded("src/components/");
            projectTree.addIncluded("src/components/root/Button.tsx");
            projectTree.addExcluded("src/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/components/Button.tsx"]);
        });

        test("should include parent folder and exclude child folder", () => {
            projectTree.addIncluded("src/components/");
            projectTree.addIncluded("src/components/root/");
            projectTree.addExcluded("src/components/root2/");
            projectTree.addExcluded("src/components/root3/");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/components/{root2,root3}"]);
        });

        test("should exclude parent folder and include child file", () => {
            projectTree.addExcluded("src/components/");
            projectTree.addIncluded("src/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/components"]);
        });

        test("should handle complex nested include/exclude", () => {
            projectTree.addIncluded("src/");
            projectTree.addExcluded("src/tests/");
            projectTree.addIncluded("src/tests/important.test.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/tests"]);
        });

        test("should handle multiple levels of overrides", () => {
            projectTree.addIncluded("project/");
            projectTree.addExcluded("project/node_modules/");
            projectTree.addIncluded("project/node_modules/important/");
            projectTree.addExcluded("project/node_modules/important/cache/");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [
                "project/node_modules",
                "project/node_modules/important/cache",
            ]);
        });

        test("can not exclude parent folder if child folder is included", () => {
            projectTree.addIncluded("src/components/");
            projectTree.addIncluded("src/components/root/");
            projectTree.addIncluded("src/components/root2/subfolder");
            projectTree.addExcluded("src/components/root2");
            projectTree.addExcluded("src/components/root3");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/components/root3"]);
        });
    });

    suite("Case Sensitivity", () => {
        test("should handle different case variations", () => {
            projectTree.addIncluded("SRC/RoOt/");
            projectTree.addExcluded("sRc/rOot/test.ts");
            const excluded = projectTree.excludedFiles();
            // Should treat as same path (case-insensitive)
            assert.deepStrictEqual(excluded, ["SRC/RoOt/test.ts"]);
        });

        test("should normalize mixed case paths", () => {
            projectTree.addIncluded("/");
            projectTree.addExcluded("SRC/Components/BUTTON.tsx");
            projectTree.addExcluded("SRc/Components/BUTTON1.tsx");
            projectTree.addExcluded("SRc/Components2/test.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["SRC"]);
        });

        test("should handle uppercase and lowercase in complex tree", () => {
            projectTree.addIncluded("Project/Src/");
            projectTree.addIncluded("Project/Src/Sub1/ModuleA/");
            projectTree.addIncluded("Project/Src/Sub1/ModuleB/");
            projectTree.addIncluded("Project/Src/Sub1/Module.Framework/");
            projectTree.addExcluded("project/SRC/test.ts");
            projectTree.addExcluded("project/SRC/Sub1/ModubleB/test.ts");
            projectTree.addExcluded("project/SRC/Sub1/ModubleB/Sub");
            projectTree.addExcluded("Project/Src/Sub1/MOdule.FrameworK/Special.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [
                "Project/Src/Sub1/Module.Framework/Special.ts",
                "Project/Src/Sub1/ModubleB",
                "Project/Src/test.ts",
            ]);
        });
    });

    suite("Edge Cases", () => {
        test("should handle paths with special characters", () => {
            projectTree.addIncluded("src/special-@file!.ts");
            projectTree.addExcluded("src/test-file.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/test-file.ts"]);
        });

        test("should handle paths with spaces", () => {
            projectTree.addIncluded("my folder/");
            projectTree.addExcluded("my folder/ok /my file.ts");
            projectTree.addExcluded("my folder/ok /my file2.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["my folder/ok "]);
        });

        test("should handle paths with dots", () => {
            projectTree.addIncluded("src/.config/");
            projectTree.addExcluded("src/.config/settings.json");
            projectTree.addExcluded("src/.vscode/file.json");
            projectTree.addExcluded("src/.xcode/file1.json");
            projectTree.addExcluded("src/.xcode/file2.json");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/.config/settings.json", "src/{.vscode,.xcode}"]);
        });

        test("should group multiple excluded files under the same parent", () => {
            projectTree.addIncluded("src/.config/");
            projectTree.addIncluded("src/.config/settings2.json");
            projectTree.addIncluded("src/.config/sub_vis/vis.json");
            projectTree.addExcluded("src/.config/sub/settings2.json");
            projectTree.addExcluded("src/.config/sub_vis/settings5.json");
            projectTree.addExcluded("src/.config/settings.json");
            projectTree.addExcluded("src/.config/settings1.json");
            projectTree.addExcluded("src/.vscode/file.json");
            projectTree.addExcluded("src/.xcode/file1.json");
            projectTree.addExcluded("src/.xcode/file2.json");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [
                "src/.config/sub_vis/settings5.json",
                "src/.config/{sub,settings.json,settings1.json}",
                "src/{.vscode,.xcode}",
            ]);
        });

        test("should handle very long paths", () => {
            const longPath = Array(50).fill("folder").join(path.sep) + path.sep + "file.ts";
            projectTree.addIncluded(
                longPath.split(path.sep).slice(0, -10).join(path.sep) + path.sep
            );
            projectTree.addExcluded(longPath);
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, [
                longPath.split(path.sep).slice(0, -9).join(path.sep),
            ]);
        });

        test("should handle unicode characters", () => {
            projectTree.addIncluded("src/文件1.ts");
            projectTree.addExcluded("src/文件.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/文件.ts"]);
        });

        test("should handle emoji in paths", () => {
            projectTree.addIncluded("src/🔥.ts");
            projectTree.addExcluded("src/🔥test.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/🔥test.ts"]);
        });
    });

    suite("Performance Tests", () => {
        test("should handle many excluded files", () => {
            projectTree.addIncluded("src/");
            for (let i = 0; i < 10000; i++) {
                projectTree.addExcluded(`src/file${i}.ts`);
            }
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 1);
        });

        test("should handle many included files", () => {
            for (let i = 0; i < 10000; i++) {
                projectTree.addIncluded(`src/file${i}.ts`);
            }
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should handle deep nesting efficiently", () => {
            const depth = 1000;
            let filePath = "root";
            for (let i = 0; i < depth; i++) {
                filePath += path.sep + `level${i}`;
            }
            filePath += path.sep + "file.ts";
            projectTree.addIncluded("root/");
            projectTree.addExcluded(filePath);
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["root/level0"]);
        });

        test("should handle wide trees efficiently", () => {
            for (let i = 0; i < 10000; i++) {
                projectTree.addExcluded(`folder${i}/file.ts`);
                projectTree.addIncluded(`folder${i + 20000}/`, true);
            }
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 1);
        });
    });

    suite("Subdirectory Behavior", () => {
        test("should exclude subdirectories when parent is excluded", () => {
            projectTree.addIncluded("src/root/");
            projectTree.addExcluded("src/root/components/Button.tsx");
            projectTree.addExcluded("src/root/components1/Button.tsx");
            projectTree.addExcluded("src/root/componentS1/Button.tsx");
            projectTree.addExcluded("src/root/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/root/{components,components1}"]);
        });

        test("should include subdirectories with includeSubfolders=true", () => {
            projectTree.addIncluded("src/root/", true);
            projectTree.addExcluded("src/root/components/Button.tsx");
            projectTree.addExcluded("src/root/components1/Button.tsx");
            projectTree.addExcluded("src/root/componentS1/Button.tsx");
            projectTree.addExcluded("src/root/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/root/{components,components1}"]);
        });

        test("should not include subdirectories with includeSubfolders=false", () => {
            projectTree.addIncluded("src/", false);
            projectTree.addExcluded("src/root/components/Button.tsx");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src/root"]);
        });
    });

    suite("Boundary Conditions", () => {
        test("should handle null-like paths gracefully", () => {
            assert.doesNotThrow(() => {
                projectTree.addExcluded("");
                projectTree.addIncluded("");
            });
        });

        test("should handle paths with only separators", () => {
            projectTree.addIncluded(path.sep);
            projectTree.addExcluded(path.sep);
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded.length, 0);
        });

        test("should handle duplicate additions", () => {
            projectTree.addIncluded("/");
            projectTree.addExcluded("src/test.ts");
            projectTree.addExcluded("src/test.ts");
            projectTree.addExcluded("src/test.ts");
            const excluded = projectTree.excludedFiles();
            assert.deepStrictEqual(excluded, ["src"]);
        });
    });
});
