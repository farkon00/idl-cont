const { parse } = require("webidl2");
const process = require('node:process');
const { readFileSync, writeFileSync } = require("fs");

const namePrefix = process.argv[4];

const INT_TYPES = ["short", "long", "unsigned short", "unsigned long", "boolean"]
const STRING_TYPES = ["DOMString", "USVString"]

function isUpperCase(str) {
    return str == str.toUpperCase();
}

/**
 * Converts the name in camelCase to snake_case
 * @param {string} originalName 
 */
function toSnakeCase(originalName) {
    let output = "";
    for (let i = 0; i < originalName.length; i++) {
        if (!isUpperCase(originalName[i]))
            output += originalName[i];
        else {
            if (i == 0 || i == originalName.length - 1)
                output += originalName[i].toLowerCase();
            else {
                if (i + 1 < originalName.length && isUpperCase(originalName[i + 1]) && isUpperCase(originalName[i - 1]))
                    output += originalName[i].toLowerCase();
                else
                    output += "_" + originalName[i].toLowerCase();
            }
        }
    }
    return output;
}

/**
 * @param {WebIDL2.AttributeMemberType} member 
 */
function handleInterfaceAttribute(member) {
    let output = "";
    if (member.idlType.union) {
        output += `JSValue:
    "${member.name}" self.get
  end\n`;
        if (!member.readonly)
            output += `  sproc !${toSnakeCase(member.name)} JSValue:
    "${member.name}" self.set
  end\n`;
    } else if (INT_TYPES.includes(member.idlType.idlType)) {
        output += `int:
    "${member.name}" self.get JSInt.unwrap dup .value swap .free
  end\n`;
        if (!member.readonly)
            output += `  sproc !${toSnakeCase(member.name)} int:
    init var value JSInt
    value "${member.name}" self.set
  end\n`;
    } else if (STRING_TYPES.includes(member.idlType.idlType)) {
        output += `@str:
    "${member.name}" self.get JSString.unwrap let string; string.value string free
  end\n`;
        if (!member.readonly)
            output += `  sproc !${toSnakeCase(member.name)} @str:
    init var value JSString
    value "${member.name}" self.set
  end\n`;
    } else {
        output += `${namePrefix}${member.idlType.idlType}:
    "${member.name}" self.get ${namePrefix}${member.idlType.idlType}.unwrap
  end\n`;
        if (!member.readonly)
            output += `  sproc !${toSnakeCase(member.name)} ${namePrefix}${member.idlType.idlType}:
    "${member.name}" self.set
  end\n`;
    }
    return output;
}

/**
 * @param {WebIDL2.InterfaceType} decl
 */
function handleInterface(decl) {
    
    let output = "";
    let afterOutput = "";
    if (decl.inheritance != "")
        output += `struct (${namePrefix}${decl.inheritance}) ${namePrefix}${decl.name}\n`;
    else
        output += `struct ${namePrefix}${decl.name}\n`;
    decl.members.forEach(member => {
        if (member.type == "attribute") {
            if (member.special == "static") {
                console.log(`Static attributes are not supported: ${decl.name}.${member.name}`);
                return;
            }
            output += `  sproc ${toSnakeCase(member.name)} -> `;
            output += handleInterfaceAttribute(member);   
        } else if (member.type == "const") {
            if (!INT_TYPES.includes(member.idlType.idlType)) {
                console.log(`Non-int constants are not supported: ${decl.name}.${member.name}`);
                return;
            }
            let value = member.value.value;
            if (member.value.type == "boolean") value = member.value.value == "true" ? 1 : 0; 
            afterOutput += `const ${namePrefix}${decl.name}.${member.name} ${value};\n`;
        } else
            console.log(`Unknown member type: ${member.type} for ${decl.name}.${member.name}`);
    });
    output += `
  static nproc unwrap JSObject self -> ${namePrefix}${decl.name}:
    "${decl.name}" self.unwrap_as (${namePrefix}${decl.name})
  end
  proc full_unwrap JSValue -> ${namePrefix}${decl.name}:
    JSObject.unwrap ${namePrefix}${decl.name}.unwrap
  end
end\n`;
    return output + afterOutput;
}

function handleDeclaration(decl) {
    if (decl.type == "interface")
        return handleInterface(decl);
    else {
        console.log(`Unknown declaration type: ${decl.type} for ${decl.name}`);
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