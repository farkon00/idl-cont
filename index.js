const { parse } = require("webidl2");
const process = require('node:process');
const { readFileSync, writeFileSync } = require("fs");

const namePrefix = process.argv[4];

function handleInterface(decl) {
    let output = "";
    if (decl.inheritance != "")
        output += `struct (${namePrefix}${decl.inheritance}) ${namePrefix}${decl.name}\n`;
    else
        output += `struct ${namePrefix}${decl.name}\n`;
    output += "end\n";
    return output;
}

function handleDeclaration(decl) {
    if (decl.type == "interface")
        return handleInterface(decl);
    else {
        console.log("Unknown declaration type:", decl.type);
        return "";
    }
}

function main() {
    const tree = parse(readFileSync(process.argv[2], "utf-8"));
    
    const declarations = tree.map(handleDeclaration);
    const res = declarations.reduce((prev, elem) => prev + elem);
    writeFileSync(process.argv[3], res)
    console.log("Finished");
}

main();