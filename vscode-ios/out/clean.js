"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanDerivedData = void 0;
function cleanDerivedData(executor) {
    executor.execShellSync("Clean Derived Data", "clean_derived_data.sh");
}
exports.cleanDerivedData = cleanDerivedData;
//# sourceMappingURL=clean.js.map