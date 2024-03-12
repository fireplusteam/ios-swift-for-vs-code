import * as vscode from 'vscode';

const testRe = /(func)([\s]+)(test?.*)(\(\s*\))/gm;
const headingRe = /(class)([\s]+)([\S]*)([\s]*:\s*)(XCTest)/gm;

function getScope(text: string, start: number, commented: boolean[]) {
    const stack = [] as string[];
    for (let i = start; i < text.length; ++i) {
        if (commented[i])
            continue;
        if (text[i] === "{") {
            stack.push(text[i]);
        } else if (text[i] === '}') {
            stack.pop();
            if (stack.length === 0)
                return i;
        }
    }
}

function preCalcLineNumbers(text: string) {
    const line = [] as number[];
    let currentNumber = 0;
    for (let i = 0; i < text.length; ++i) {
        line.push(currentNumber);
        currentNumber += text[i] == '\n' ? 1 : 0;
    }
    return line;
}

enum Commented {
    notCommented,
    singleCommented,
    multiCommented
}

function preCalcCommentedCode(text: string) {
    const line = [] as boolean[];
    let commented = Commented.notCommented;
    for (let i = 0; i < text.length - 1; ++i) {
        switch (commented) {
            case Commented.notCommented:
                if (text[i] === '/' && text[i + 1] === '/') {
                    commented = Commented.singleCommented
                } else if (text[i] == '/' && text[i + 1] == '*') {
                    commented = Commented.multiCommented;
                }
                break;
            case Commented.singleCommented:
                if (text[i] === "\n") {
                    commented = Commented.notCommented;
                }
                break;
            case Commented.multiCommented:
                if (text[i] == '*' && text[i + 1] == '/') {
                    commented = Commented.notCommented;
                }
                break;
        }
        line.push(commented !== Commented.notCommented);
    }
    return line;
}

function isCommented(commented: boolean[], start: number, end: number) {
    for (let i = start; i < end; ++i)
        if (commented[i])
            return true;
    return false;
}

export const parseMarkdown = (text: string, events: {
    onTest(range: vscode.Range, testName: string): void;
    onHeading(range: vscode.Range, name: string): void;
}) => {
    const lineNumbers = preCalcLineNumbers(text);
    const commented = preCalcCommentedCode(text);

    const classes = [...text.matchAll(headingRe)];
    for (const classRef of classes) {
        const classStartInd = classRef.index || 0;
        const classEndInd = classStartInd + classRef[0].length;
        if (isCommented(commented, classStartInd, classEndInd))
            continue;

        const [, , , name] = classRef;
        const endScope = getScope(text, classStartInd, commented) || classEndInd;

        const range = new vscode.Range(new vscode.Position(lineNumbers[classStartInd], 0), new vscode.Position(lineNumbers[endScope], 10000));
        events.onHeading(range, name);

        const tests = [...text.slice(classStartInd, endScope).matchAll(testRe)];
        for (const test of tests) {
            const testStartInd = (test.index || 0) + classStartInd;
            const testEndInd = testStartInd + test[0].length;
            if (isCommented(commented, testStartInd, testEndInd))
                continue;

            const [, , , testName,] = test;
            const endTestScope = getScope(text, testStartInd, commented) || testEndInd;

            const range = new vscode.Range(new vscode.Position(lineNumbers[testStartInd], 0), new vscode.Position(lineNumbers[testEndInd], 10000));
            events.onTest(range, testName);
        }
    }
};