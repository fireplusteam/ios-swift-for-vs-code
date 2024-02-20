import * as vscode from "vscode";

export async function showPicker(
  json: string,
  title: string,
  placeholder: string,
  canPickMany = false
) {
  const items: vscode.QuickPickItem[] = JSON.parse(json);
  let selection = await vscode.window.showQuickPick<vscode.QuickPickItem>(
    items,
    {
      title: title,
      placeHolder: placeholder,
      canPickMany: canPickMany,
    }
  );

  if (selection === undefined) {
    return undefined;
  }

  let value: string | undefined;

  if (typeof selection === "string") {
    value = selection as string;
  }

  if (typeof selection === "object") {
    if (selection === null) {
      value = undefined;
    } else {
      if (canPickMany) {
        const array = (selection as unknown as { [key: string]: any }[]).map((e) => {
          return e["value"];
        });
        
        value = array.join(" ");
      } else {
          const dict = selection as { [key: string]: any };
          value = dict["value"];
      }
    }
  }

  return value;
}
