import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from "vscode";
import { _private } from "../../src/LSP/DefinitionProvider";
// import * as myExtension from '../../extension';

suite("Definition Provider: Split Container", () => {
    test("Test 1", async () => {
        const result = _private.splitContainers(new Set(["Promise<Int>.Resolver"]));
        assert.deepStrictEqual(result, new Set(["Resolver"]));
    });

    test("Test 2", async () => {
        const result = _private.splitContainers(new Set(["Promise<Int>"]));
        assert.deepStrictEqual(result, new Set(["Promise"]));
    });

    test("Test 3", async () => {
        const result = _private.splitContainers(
            new Set(["Promise<Int,Sub<T1, T2>>.Second<One>.Ok<T>"])
        );
        assert.deepStrictEqual(result, new Set(["Ok"]));
    });

    test("Test 4", async () => {
        const result = _private.splitContainers(
            new Set(["Promise<(),Sub<() -> Void, () -> () -> ()>>.Second.Ok"])
        );
        assert.deepStrictEqual(result, new Set(["Ok"]));
    });

    test("Test 6", async () => {
        const result = _private.splitContainers(new Set(["Int", "String", "One.Two", ""]));
        assert.deepStrictEqual(result, new Set(["Int", "String", "Two"]));
    });
});

suite("Definition Provider: Type Parser", () => {
    test("Test 1", async () => {
        const result = _private.parseVariableType("let a: Type");
        assert.deepStrictEqual(result, "Type");
    });

    test("Test 2", async () => {
        const result = _private.parseVariableType("swift\n```var a: StateValue<ProductState>");
        assert.deepStrictEqual(result, "StateValue<ProductState>");
    });

    test("Test 3", async () => {
        const result = _private.parseVariableType("swift\n```var a: StateValue<ProductState, T>");
        assert.deepStrictEqual(result, "StateValue<ProductState,T>");
    });

    test("Test 4", async () => {
        const result = _private.parseVariableType(`var a: StateValue<
                ProductState,
                T/* Good enough */,
                OpenT< K1,  K2>, // open bot
                Drop<() -> Void>
            >`);
        assert.deepStrictEqual(result, "StateValue<ProductState,T,OpenT<K1,K2>,Drop<()->Void>");
    });

    test("Test 5", async () => {
        const result = _private.parseVariableType(`let productId: SizeUseCase.Input`);
        assert.deepStrictEqual(result, "SizeUseCase.Input");
    });

    test("Test 6", async () => {
        const result = _private.parseVariableType(`let productId: SizeUseCase.Input<P>? next`);
        assert.deepStrictEqual(result, "SizeUseCase.Input<P>?");
    });

    test("Test 7", async () => {
        const result = _private.parseVariableType(
            `let productId: SizeUseCase.Pr.Input<  P>  ? next`
        );
        assert.deepStrictEqual(result, "SizeUseCase.Pr.Input<P>?");
    });

    test("Test 8.class", async () => {
        const result = _private.parseVariableType(`class PreferredSizeIndexFinder`);
        assert.deepStrictEqual(result, "PreferredSizeIndexFinder");
    });

    test("Test 8.struct", async () => {
        const result = _private.parseVariableType(`struct PreferredSizeIndexFinder {}`);
        assert.deepStrictEqual(result, "PreferredSizeIndexFinder");
    });

    test("Test 8.enum", async () => {
        const result = _private.parseVariableType(`enum Enn : String `);
        assert.deepStrictEqual(result, "Enn");
    });

    test("Test 8.protocol", async () => {
        const result = _private.parseVariableType(` protocol SomeProtocol : class `);
        assert.deepStrictEqual(result, "SomeProtocol");
    });

    test("Test 9", async () => {
        const result = _private.parseVariableType("static let dummy: `Self`");
        assert.deepStrictEqual(result, "Self");
    });

    test("Test 10", async () => {
        const result = _private.parseVariableType("let sizes: [ProductState.Size]?");
        assert.deepStrictEqual(result, "[ProductState.Size]?");
    });

    test("Test 10. , at end", async () => {
        const result = _private.parseVariableType("let sizes: [ProductState.Size]?,");
        assert.deepStrictEqual(result, "[ProductState.Size]?");
    });

    test("Test 10. ; at end", async () => {
        const result = _private.parseVariableType("let sizes: [ProductState.Size]?;");
        assert.deepStrictEqual(result, "[ProductState.Size]?");
    });

    test("Test 10. ) at end", async () => {
        const result = _private.parseVariableType(
            "@Dependency(\\.productService) var productService: any ProductService)"
        );
        assert.deepStrictEqual(result, "ProductService");
    });

    test("Test 11", async () => {
        const result = _private.parseVariableType(
            "@Dependency var productService: any ProductService { get } "
        );
        assert.deepStrictEqual(result, "ProductService");
    });

    test("Test 12", async () => {
        const result = _private.parseVariableType(
            `@Dependency var body: some View<Text> { 
                Text("ok")
            } `
        );
        assert.deepStrictEqual(result, "View<Text>");
    });

    test("Test 13", async () => {
        const result = _private.parseVariableType(
            `func values<T>(observe mapper: @escaping @Sendable (State) -> T, secondParam param: @escaping @Sendable (T, T) -> Bool) -> AsyncStream<T> where T : Sendable`
        );
        assert.deepStrictEqual(result, "AsyncStream<T>");
    });

    test("Test 14", async () => {
        const result = _private.parseVariableType(
            `func values<T>(observe mapper: @escaping @Sendable (State) -> T, secondParam param: @escaping @Sendable (T, T) -> Bool) async throw {
            }`
        );
        assert.deepStrictEqual(result, "Void");
    });

    test("Test 15", async () => {
        const result = _private.parseVariableType(
            `func values<T>(observe mapper: @escaping @Sendable (State) -> T, secondParam param: @escaping @Sendable (T, T) -> Bool) async throw -> (SomeParam) -> some SomeType {
            }`
        );
        assert.deepStrictEqual(result, "SomeType");
    });

    test("Test 16", async () => {
        const result = _private.parseVariableType(
            `func get(forProductId productId: String) -> any OptionalType`
        );
        assert.deepStrictEqual(result, "OptionalType");
    });

    test("Test 17", async () => {
        const result = _private.parseVariableType(`let some: () -> ()`);
        assert.deepStrictEqual(result, "Void");
        const result2 = _private.parseVariableType(`let some: () -> () -> () -> ()`);
        assert.deepStrictEqual(result2, "Void");
        const result3 = _private.parseVariableType(`let some: () -> () -> () -> (Some) -> Param`);
        assert.deepStrictEqual(result3, "Param");
    });

    test("Test 18", async () => {
        const result = _private.parseVariableType(`case one`);
        assert.deepStrictEqual(result, undefined);
    });

    test("Test 19", async () => {
        const result = _private.parseVariableType(
            `public let execute: (Input) async throws -> Output `
        );
        assert.deepStrictEqual(result, "Output");
    });

    test("Test 20", async () => {
        const result = _private.parseVariableType(
            `public typealias SizePreselectorUseCase.Output = ProductSize?`
        );
        assert.deepStrictEqual(result, "ProductSize?");
    });

    test("Test 21", async () => {
        const result = _private.parseVariableType(
            `public typealias SizePreselectorUseCase.Output = () -> ProductSize?`
        );
        assert.deepStrictEqual(result, "ProductSize?");
    });
});

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
                true.emptyFunction(10)
                let ch = '"'

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

    test("Test 10", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("emptyFunction"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "emptyFunction");
        assert.strictEqual(result?.container, "true");
        assert.deepStrictEqual(result?.args, ["_"]);
    });
});

suite("Definition Provider: text with optionals", () => {
    const textWithComments = `
                let obj: Obj = .init?(a: 10)
                let object = SomeStruct().var1?.some!.fun(
                    a: b,
                    c: anotherObject?.doSomething! (  )
                )
                char ch = '\\''
                option?.functionWithSingleParam!('"')
                option?.anotherWay?('"\\'', "ok'", '\\'')
        `;

    test("Test 1", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("it?(a: "),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "init");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["a"]);
    });

    test("Test 2", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("e!."),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "some");
        assert.strictEqual(result?.container, "var1");
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 3", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("fun("),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "fun");
        assert.strictEqual(result?.container, "some");
        assert.deepStrictEqual(result?.args, ["a", "c"]);
    });

    test("Test 4", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("ethi"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "doSomething");
        assert.strictEqual(result?.container, "anotherObject");
        assert.deepStrictEqual(result?.args, ["_"]);
    });

    test("Test 5", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("unction"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "functionWithSingleParam");
        assert.strictEqual(result?.container, "option");
        assert.deepStrictEqual(result?.args, ["_"]);
    });

    test("Test 6", async () => {
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("anotherWay"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "anotherWay");
        assert.strictEqual(result?.container, "option");
        assert.deepStrictEqual(result?.args, ["_", "_", "_"]);
    });
});

suite("Definition Provider: Declarative and Separators", () => {
    test("Test 1", async () => {
        const textWithComments = `
            case .updateAvailability:
                asfjaksj
                return someService
                    .someAction()
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("someAction"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "someAction");
        assert.strictEqual(result?.container, "someService");
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 2", async () => {
        const textWithComments = `
            case .updateAvailability:
                asfjaksj
                return someService
                    .someAction()
                    .race(on: Dispatch.main)
                    .catch(with: .main)
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("race"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "race");
        assert.strictEqual(result?.container, "someAction");
        assert.deepStrictEqual(result?.args, ["on"]);
    });

    test("Test 3", async () => {
        const textWithComments = `
            let a = some + .opt(val)
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("opt"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "opt");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["_"]);
    });

    test("Test 4", async () => {
        const textWithComments = `
            let a = some && .opt(val)
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("opt"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "opt");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["_"]);
    });

    test("Test 3", async () => {
        const textWithComments = `
            let a = some - .secods * .opt(val, in: one, where: two) { return "ok" }
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("opt"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "opt");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["_", "in", "where"]);
    });

    test("Test 4", async () => {
        const textWithComments = `
            let a = some - .secods * prefix_L_Right.opt_trail_Ok(Va_l, In: ONE, where: Two) { return "ok" }
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("opt"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "opt_trail_Ok");
        assert.strictEqual(result?.container, "prefix_L_Right");
        assert.deepStrictEqual(result?.args, ["_", "In", "where"]);
    });
    test("Test 5", async () => {
        const textWithComments = `
            return .send(.reload(updated))
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("send"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "send");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, ["_"]);
    });

    test("Test 6", async () => {
        const textWithComments = `
            var ab = .send(.reload(updated))
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("ab"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "ab");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 7", async () => {
        const textWithComments = `
            let ab = .send(.reload(updated))
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("ab"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "ab");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 8", async () => {
        const textWithComments = `
            if ab == .send(.reload(updated))
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("ab"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "ab");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });

    test("Test 8", async () => {
        const textWithComments = `
            else ab == .send(.reload(updated))
        `;
        const result = _private.getSymbolAtPosition(
            textWithComments.indexOf("ab"),
            textWithComments
        );
        assert.strictEqual(result?.symbol, "ab");
        assert.strictEqual(result?.container, undefined);
        assert.deepStrictEqual(result?.args, []);
    });
});
