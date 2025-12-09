import * as assert from "assert";
import * as vscode from "vscode";
import { TestTreeContext } from "../../../src/TestsProvider/TestTreeContext";
import { TestContainer } from "../../../src/TestsProvider/TestItemProvider/TestContainer";
import { TestCase } from "../../../src/TestsProvider/TestItemProvider/TestCase";
import { LSPTestsProvider } from "../../../src/LSP/LSPTestsProvider";
import { AtomicCommand } from "../../../src/CommandManagement/AtomicCommand";

suite("TestTreeContext", () => {
    let context: TestTreeContext;
    let mockLSPProvider: LSPTestsProvider;
    let mockAtomicCommand: AtomicCommand;

    setup(() => {
        mockLSPProvider = {} as LSPTestsProvider;
        mockAtomicCommand = {} as AtomicCommand;
        context = new TestTreeContext(mockLSPProvider, mockAtomicCommand);
    });

    teardown(() => {
        context.ctrl.dispose();
    });

    suite("TestID", () => {
        test("should create correct ID for file protocol", () => {
            const uri = vscode.Uri.file("/path/to/file.swift");
            const id = TestTreeContext.TestID("file://", uri);
            assert.strictEqual(id, `file:///${uri.toString()}`);
        });

        test("should create correct ID for target protocol", () => {
            const uri = vscode.Uri.file("/path/to/target");
            const id = TestTreeContext.TestID("target://", uri);
            assert.strictEqual(id, `target:///${uri.toString()}`);
        });

        test("should create correct ID for project protocol", () => {
            const uri = vscode.Uri.file("/path/to/project");
            const id = TestTreeContext.TestID("project://", uri);
            assert.strictEqual(id, `project:///${uri.toString()}`);
        });
    });

    suite("getTargetFilePath", () => {
        test("should create path with project path", () => {
            const projectPath = vscode.Uri.file("/project");
            const result = TestTreeContext.getTargetFilePath(projectPath, "MyTarget");
            assert.ok(result.toString().includes("MyTarget"));
        });

        test("should handle undefined project path", () => {
            const result = TestTreeContext.getTargetFilePath(undefined, "MyTarget");
            assert.ok(result.toString().includes("MyTarget"));
        });
    });

    suite("getOrCreateTest", () => {
        test("should create new test item if not exists", () => {
            const uri = vscode.Uri.file("/test.swift");
            const mockData: TestContainer = {} as TestContainer;
            const result = context.getOrCreateTest("file://", uri, () => mockData);

            assert.ok(result.file);
            assert.strictEqual(result.data, mockData);
            assert.strictEqual(result.file.canResolveChildren, true);
        });

        test("should return existing test item", () => {
            const uri = vscode.Uri.file("/test.swift");
            const mockData: TestContainer = {} as TestContainer;
            const first = context.getOrCreateTest("file://", uri, () => mockData);
            const secondData: TestContainer = {} as TestContainer;
            const second = context.getOrCreateTest("file://", uri, () => secondData);

            assert.strictEqual(first.file, second.file);
            assert.strictEqual(first.data, second.data);
        });

        test("should extract filename from uri path", () => {
            const uri = vscode.Uri.file("/path/to/TestFile.swift");
            const mockData: TestContainer = {} as TestContainer;
            const result = context.getOrCreateTest("file://", uri, () => mockData);

            assert.strictEqual(result.file.label, "TestFile.swift");
        });
    });

    suite("addItem", () => {
        test("should add item to matching root", () => {
            const rootUri = vscode.Uri.file("/root.swift");
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest("file://", rootUri, () => mockData);

            const newItem = context.ctrl.createTestItem("child", "Child");
            const added = context.addItem(newItem, r => r.id === root.file.id);

            assert.strictEqual(added, true);
            assert.strictEqual(root.file.children.size, 1);
        });

        test("should add item to nested child", () => {
            const rootUri = vscode.Uri.file("/root.swift");
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest("file://", rootUri, () => mockData);

            const childItem = context.ctrl.createTestItem("child", "Child");
            root.file.children.add(childItem);

            const newItem = context.ctrl.createTestItem("nested", "Nested");
            const added = context.addItem(newItem, r => r.id === "child");

            assert.strictEqual(added, true);
            assert.strictEqual(childItem.children.size, 1);
        });

        test("should return false when no matching item found", () => {
            const newItem = context.ctrl.createTestItem("item", "Item");
            const added = context.addItem(newItem, () => false);

            assert.strictEqual(added, false);
        });

        test("should stop searching after finding first match", () => {
            const mockData1: TestContainer = {} as TestContainer;
            const root1 = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root1.swift"),
                () => mockData1
            );
            const mockData2: TestContainer = {} as TestContainer;
            const root2 = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root2.swift"),
                () => mockData2
            );

            const newItem = context.ctrl.createTestItem("item", "Item");
            context.addItem(newItem, () => true);

            // Should only be added to first root
            assert.ok(root1.file.children.size === 1 || root2.file.children.size === 1);
            assert.notStrictEqual(root1.file.children.size + root2.file.children.size, 2);
        });
    });

    suite("deleteItem", () => {
        test("should delete item by string id", () => {
            const uri = vscode.Uri.file("/test.swift");
            const mockData: TestContainer = {} as TestContainer;
            const result = context.getOrCreateTest("file://", uri, () => mockData);

            context.deleteItem(result.file.id);

            assert.strictEqual(context.ctrl.items.size, 0);
        });

        test("should delete item by TestItem reference", () => {
            const uri = vscode.Uri.file("/test.swift");
            const mockData: TestContainer = {} as TestContainer;
            const result = context.getOrCreateTest("file://", uri, () => mockData);

            context.deleteItem(result.file);

            assert.strictEqual(context.ctrl.items.size, 0);
        });

        test("should delete child item from parent", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const child = context.ctrl.createTestItem("child", "Child");
            root.file.children.add(child);

            context.deleteItem(child);

            assert.strictEqual(root.file.children.size, 0);
        });

        test("should handle deleting non-existent item", () => {
            assert.doesNotThrow(() => {
                context.deleteItem("non-existent-id");
            });
        });
    });

    suite("replaceItemsChildren", () => {
        test("should replace all children with new items", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const oldChild = context.ctrl.createTestItem("old", "Old");
            root.file.children.add(oldChild);

            const newChild1 = context.ctrl.createTestItem("new1", "New1");
            const newChild2 = context.ctrl.createTestItem("new2", "New2");

            context.replaceItemsChildren(root.file, [newChild1, newChild2]);

            assert.strictEqual(root.file.children.size, 2);
            assert.strictEqual(root.file.children.get("new1"), newChild1);
            assert.strictEqual(root.file.children.get("new2"), newChild2);
            assert.strictEqual(root.file.children.get("old"), undefined);
        });

        test("should handle empty replacement array", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const child = context.ctrl.createTestItem("child", "Child");
            root.file.children.add(child);

            context.replaceItemsChildren(root.file, []);

            assert.strictEqual(root.file.children.size, 0);
        });
    });

    suite("allTestItems", () => {
        test("should return empty array when no items", () => {
            const items = context.allTestItems();
            assert.strictEqual(items.length, 0);
        });

        test("should return all root items", () => {
            const mockData1: TestContainer = {} as TestContainer;
            context.getOrCreateTest("file://", vscode.Uri.file("/test1.swift"), () => mockData1);
            const mockData2: TestContainer = {} as TestContainer;
            context.getOrCreateTest("file://", vscode.Uri.file("/test2.swift"), () => mockData2);

            const items = context.allTestItems();
            assert.strictEqual(items.length, 2);
        });

        test("should return nested items", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const child1 = context.ctrl.createTestItem("child1", "Child1");
            const child2 = context.ctrl.createTestItem("child2", "Child2");
            root.file.children.add(child1);
            child1.children.add(child2);

            const items = context.allTestItems();
            assert.strictEqual(items.length, 3);
        });

        test("should return items in hierarchical order", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const child = context.ctrl.createTestItem("child", "Child");
            root.file.children.add(child);

            const items = context.allTestItems();
            assert.strictEqual(items[0].id, root.file.id);
            assert.strictEqual(items[1].id, child.id);
        });
    });

    suite("private get method", () => {
        test("should find deeply nested item", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const child = context.ctrl.createTestItem("child", "Child");
            const grandchild = context.ctrl.createTestItem("grandchild", "Grandchild");
            root.file.children.add(child);
            child.children.add(grandchild);

            const found = context["get"]("grandchild", context.ctrl.items);
            assert.strictEqual(found?.id, "grandchild");
        });

        test("should return undefined for non-existent item", () => {
            const mockData: TestContainer = {} as TestContainer;
            context.getOrCreateTest("file://", vscode.Uri.file("/root.swift"), () => mockData);
            const found = context["get"]("non-existent", context.ctrl.items);
            assert.strictEqual(found, undefined);
        });
    });

    suite("edge cases", () => {
        test("should handle items with special characters in path", () => {
            const uri = vscode.Uri.file("/path/with spaces/Test-File_2.swift");
            const mockData: TestContainer = {} as TestContainer;
            const result = context.getOrCreateTest("file://", uri, () => mockData);
            assert.ok(result.file);
        });

        test("should handle multiple children with same label", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const child1 = context.ctrl.createTestItem("id1", "SameLabel");
            const child2 = context.ctrl.createTestItem("id2", "SameLabel");
            root.file.children.add(child1);
            root.file.children.add(child2);

            assert.strictEqual(root.file.children.size, 2);
        });

        test("should handle circular reference prevention in get", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );
            const found = context["get"](root.file.id, context.ctrl.items);
            assert.strictEqual(found?.id, root.file.id);
        });
    });
    suite("tree structure manipulation", () => {
        test("should maintain correct structure when adding and removing multiple levels", () => {
            // Create root
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );

            // Add first level children
            const class1 = context.ctrl.createTestItem("class1", "TestClass1");
            const class2 = context.ctrl.createTestItem("class2", "TestClass2");
            root.file.children.add(class1);
            root.file.children.add(class2);

            // Add second level children
            const method1 = context.ctrl.createTestItem("method1", "testMethod1");
            const method2 = context.ctrl.createTestItem("method2", "testMethod2");
            const method3 = context.ctrl.createTestItem("method3", "testMethod3");
            class1.children.add(method1);
            class1.children.add(method2);
            class2.children.add(method3);

            // Verify structure
            assert.strictEqual(context.ctrl.items.size, 1);
            assert.strictEqual(root.file.children.size, 2);
            assert.strictEqual(class1.children.size, 2);
            assert.strictEqual(class2.children.size, 1);
            assert.strictEqual(context.allTestItems().length, 6);

            // Remove middle level item
            context.deleteItem(class1);
            assert.strictEqual(root.file.children.size, 1);
            assert.strictEqual(context.allTestItems().length, 3);

            // Verify remaining structure
            assert.strictEqual(root.file.children.get("class2"), class2);
            assert.strictEqual(root.file.children.get("class1"), undefined);
        });

        test("should handle adding and removing items in different orders", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );

            // Add items
            const items: vscode.TestItem[] = [];
            for (let i = 0; i < 5; i++) {
                const item = context.ctrl.createTestItem(`item${i}`, `Item${i}`);
                items.push(item);
                root.file.children.add(item);
            }

            assert.strictEqual(root.file.children.size, 5);

            // Remove items in reverse order
            for (let i = items.length - 1; i >= 0; i--) {
                context.deleteItem(items[i]);
                assert.strictEqual(root.file.children.size, i);
            }

            assert.strictEqual(root.file.children.size, 0);
        });

        test("should maintain structure integrity after replacing children", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );

            // Add initial structure
            const oldChild1 = context.ctrl.createTestItem("old1", "Old1");
            const oldChild2 = context.ctrl.createTestItem("old2", "Old2");
            const oldGrandchild = context.ctrl.createTestItem("oldGrand", "OldGrand");
            root.file.children.add(oldChild1);
            root.file.children.add(oldChild2);
            oldChild1.children.add(oldGrandchild);

            // Replace with new structure
            const newChild1 = context.ctrl.createTestItem("new1", "New1");
            const newChild2 = context.ctrl.createTestItem("new2", "New2");
            const newGrandchild = context.ctrl.createTestItem("newGrand", "NewGrand");
            newChild1.children.add(newGrandchild);

            context.replaceItemsChildren(root.file, [newChild1, newChild2]);

            // Verify new structure
            assert.strictEqual(root.file.children.size, 2);
            assert.strictEqual(root.file.children.get("new1"), newChild1);
            assert.strictEqual(root.file.children.get("new2"), newChild2);
            assert.strictEqual(newChild1.children.size, 1);
            assert.strictEqual(newChild1.children.get("newGrand"), newGrandchild);

            // Verify old structure is gone
            assert.strictEqual(root.file.children.get("old1"), undefined);
            assert.strictEqual(root.file.children.get("old2"), undefined);
        });

        test("should handle deep nesting and verify structure", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );

            // Create deep nesting
            let currentParent = root.file;
            const depth = 10;
            for (let i = 0; i < depth; i++) {
                const child = context.ctrl.createTestItem(`level${i}`, `Level${i}`);
                currentParent.children.add(child);
                currentParent = child;
            }

            // Verify depth
            const allItems = context.allTestItems();
            assert.strictEqual(allItems.length, depth + 1); // +1 for root

            // Verify we can find deepest item
            const deepest = context["get"](`level${depth - 1}`, context.ctrl.items);
            assert.ok(deepest);
            assert.strictEqual(deepest.label, `Level${depth - 1}`);

            // Delete from middle
            context.deleteItem(`level${depth / 2}`);

            // Verify partial structure remains
            const middle = context["get"](`level${depth / 2}`, context.ctrl.items);
            assert.strictEqual(middle, undefined);
        });

        test("should maintain test data associations during structure changes", () => {
            const mockData1: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData1
            );

            const child = context.ctrl.createTestItem("child", "Child");
            const childData: TestCase = {} as TestCase;
            context.testData.set(child, childData);
            root.file.children.add(child);

            // Verify data association
            assert.strictEqual(context.testData.get(root.file), mockData1);
            assert.strictEqual(context.testData.get(child), childData);

            // Move child to new structure
            const newRoot = context.ctrl.createTestItem("newRoot", "NewRoot");
            const newRootData: TestContainer = {} as TestContainer;
            context.testData.set(newRoot, newRootData);
            context.ctrl.items.add(newRoot);

            root.file.children.delete(child.id);
            newRoot.children.add(child);

            // Verify data associations maintained
            assert.strictEqual(context.testData.get(child), childData);
            assert.strictEqual(context.testData.get(newRoot), newRootData);
        });

        test("should handle concurrent additions and deletions", () => {
            const mockData: TestContainer = {} as TestContainer;
            const root = context.getOrCreateTest(
                "file://",
                vscode.Uri.file("/root.swift"),
                () => mockData
            );

            // Add multiple children
            const children: vscode.TestItem[] = [];
            for (let i = 0; i < 10; i++) {
                const child = context.ctrl.createTestItem(`child${i}`, `Child${i}`);
                children.push(child);
                root.file.children.add(child);
            }

            // Remove even-indexed children while structure exists
            for (let i = 0; i < children.length; i += 2) {
                context.deleteItem(children[i]);
            }

            // Verify only odd-indexed remain
            assert.strictEqual(root.file.children.size, 5);
            for (let i = 1; i < children.length; i += 2) {
                assert.strictEqual(root.file.children.get(`child${i}`), children[i]);
            }
        });
    });
});
