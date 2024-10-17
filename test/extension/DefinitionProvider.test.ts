import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from "vscode";
import { _private } from "../../src/LSP/DefinitionProvider";
// import * as myExtension from '../../extension';

suite("Definition Provider: Complex text with comments", () => {
    const textWithComments = `
            let a = fgdg comment_ba2.sub.doSome(
                name1: "10",
                name2: /*""*/ //, op: 1,
                SubComment( /* ok */
                    /*gfg*/ prop1:  10/* ,sdfkgjfg: */, prop2/*fgf*/: /*fgf*/ "10" //, prop3: 20
                )
            )
        `;

    test("Test 1", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("comm"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "comment_ba2");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 2", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("2"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "comment_ba2");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 3", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("."),
            textWithComments
        );
        assert.strictEqual(result, undefined);
    });

    test("Test 4", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("sub"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "sub");
        assert.strictEqual(result?.container, "comment_ba2");
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 5", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("Some"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "doSome");
        assert.strictEqual(result?.container, "sub");
        assert.deepStrictEqual(result?.args, ["name1", "name2"]);
    });

    test("Test 6", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("("),
            textWithComments
        );
        assert.strictEqual(result, undefined);
    });

    test("Test 7", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf(":"),
            textWithComments
        );
        assert.strictEqual(result, undefined);
    });

    test("Test 8", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("e1"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "doSome");
        assert.strictEqual(result?.container, "sub");
        assert.deepStrictEqual(result?.args, ["name1", "name2"]);
    });

    test("Test 9", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("name2"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "doSome");
        assert.strictEqual(result?.container, "sub");
        assert.deepStrictEqual(result?.args, ["name1", "name2"]);
    });

    test("Test 10", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("Comment("),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "SubComment");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["prop1", "prop2"]);
    });

    test("Test 11", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("rop2"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "SubComment");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["prop1", "prop2"]);
    });
});

suite("Definition Provider: Functions text with comments", () => {
    const textWithComments = `
            some(a: 10, b: "")
                print("ok")

//                let obj: Obj = .init?(a: 10)

                let fdgd = 0
//                fsdfgfsg
                let comment = Comment1(
                    b:
                    10
                )
//                sdfs
                let comment_ba2 = Comment1(
                    b: 10,

                    sub:
                    .init(prop1: 10, prop2: "10")
                )

                sdfsdf
                
                let dfs: SomeEnum = .two
                someEmptyFunc()
                gfdgdf
                someMethod2(a: [
                    10,
                    .fixture(someParam: 10, 20, in: 20),
                    .fixture(someParam: 10, in: 30),
                    .fixture(someParam: 20) {},
                ])
                let openFunction = PreStruct(a: "100([{", someArg: "20:30  }" ,  ok ).openFunc(someExp: /*case:{*/ , B2: [10, 20, ["30", "40"]])
                let str: String = .fixture(bla: [10, [20], (10)]).count
                functionWithSingleParam("skgjd:][{}( dsdfg : func(a: 10, b: 20)")
                let a = SomeEnum().one
        `;

    test("Test 1", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("prop1: 10"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "init");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["prop1", "prop2"]);
    });

    test("Test 2", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("meParam: 10, 20, i"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "fixture");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["someParam", "_", "in"]);
    });

    test("Test 3", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("m: 20) {}"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "fixture");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["someParam"]);
    });

    test("Test 4", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("one"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "one");
        assert.strictEqual(result?.container, "SomeEnum");
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 5", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("penFunc(someExp"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "openFunc");
        assert.strictEqual(result?.container, "PreStruct");
        assert.deepStrictEqual(result?.args, ["someExp", "B2"]);
    });

    test("Test 6", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf('2: [10, 20, ["30", "40"'),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "openFunc");
        assert.strictEqual(result?.container, "PreStruct");
        assert.deepStrictEqual(result?.args, ["someExp", "B2"]);
    });

    test("Test 7", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("eStruct"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "PreStruct");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["a", "someArg", "_"]);
    });

    test("Test 8", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("ptyFunc()"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "someEmptyFunc");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 9", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("functionWithSingleParam"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "functionWithSingleParam");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["_"]);
    });
});
