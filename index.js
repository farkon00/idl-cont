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
 * @param {string} owner
 */
function handleInterfaceAttribute(member, owner) {
    let output = "";
    if (member.idlType.union) {
        output += `JSValue:
  "${member.name}" self.get
end\n`;
        if (!member.readonly)
            output += `sproc [${owner}] !${toSnakeCase(member.name)} JSValue:
  "${member.name}" self.set
end\n`;
    } else if (INT_TYPES.includes(member.idlType.idlType)) {
        output += `int:
  "${member.name}" self.get JSInt.unwrap dup .value swap .free
end\n`;
        if (!member.readonly)
            output += `  sproc [${owner}] !${toSnakeCase(member.name)} int:
  init var value JSInt
  value "${member.name}" self.set
end\n`;
    } else if (STRING_TYPES.includes(member.idlType.idlType)) {
        output += `@str:
  "${member.name}" self.get JSString.unwrap let string; string.value string free
end\n`;
        if (!member.readonly)
            output += `  sproc [${owner}] !${toSnakeCase(member.name)} @str:
  init var value JSString
  value "${member.name}" self.set
end\n`;
    } else {
        output += `${namePrefix}${member.idlType.idlType}:
  "${member.name}" self.get ${namePrefix}${member.idlType.idlType}.full_unwrap
end\n`;
        if (!member.readonly)
            output += `  sproc [${owner}] !${toSnakeCase(member.name)} ${namePrefix}${member.idlType.idlType}:
  "${member.name}" self.set
end\n`;
    }
    return output;
}

/**
 * 
 * @param {WebIDL2.IDLTypeDescription} type
 * @param {boolean} isReturn 
 */
function typeToCont(type, isReturn) {
    if (type.generic) {
        console.log(`Generic types are not supported: ${type.idlType}`);
        return "";
    }
    let prefix = isReturn ? "-> " : ""; 
    if (type.union)
        return prefix + "JSValue ";
    else if (INT_TYPES.includes(type.idlType))
        return prefix + "int ";
    else if (STRING_TYPES.includes(type.idlType))
        return prefix + "@str ";
    else if (type.idlType == "undefined")
        if (isReturn)
            return "";
        else {
            console.log("A non-return type is undefined");
            return "JSUndefined ";
        }
    else
        return prefix + `${namePrefix}${type.idlType} `;
}

/**
 * 
 * @param {WebIDL2.IDLTypeDescription} type
 * @param {number} argNum 
 */
function loadIntoJS(type, argNum) {
    if (type.generic) {
        console.log(`Generic types are not supported: ${type.idlType}`);
        return "";
    }
    if (type.union || type.idlType == "undefined")
        return `  let arg${argNum};\n`;
    else if (INT_TYPES.includes(type.idlType))
        return `  init var arg${argNum} JSInt\n`;
    else if (STRING_TYPES.includes(type.idlType))
        return `  init var arg${argNum} JSString\n`;
    else
        return `  let arg${argNum};\n`;
}

/**
 * 
 * @param {WebIDL2.IDLTypeDescription} type
 */
function loadFromJS(type) {
    if (type.generic) {
        console.log(`Generic types are not supported: ${type.idlType}`);
        return "";
    }
    if (type.union)
        return "";
    else if (INT_TYPES.includes(type.idlType))
        return "  JSInt.unwrap let res; res.value res.free\n";
    else if (STRING_TYPES.includes(type.idlType))
        return `  JSString.unwrap let res; res.value res free\n`;
    else if (type.idlType == "undefined")
        return "  .free\n";
    else
        return `  ${namePrefix}${type.idlType}.full_unwrap\n`;
}

/**
 * @param {WebIDL2.InterfaceType} decl
 */
function handleInterface(decl) {
    let parent = decl.inheritance ? `${namePrefix}${decl.inheritance}` : "JSObject"
    let output = `struct (${parent}) ${namePrefix}${decl.name}
  static nproc unwrap JSObject self -> ${namePrefix}${decl.name}:
    "${decl.name}" self.unwrap_as (${namePrefix}${decl.name})
  end
  proc full_unwrap JSValue -> ${namePrefix}${decl.name}:
    JSObject.unwrap ${namePrefix}${decl.name}.unwrap
  end
end\n`;
    let afterOutput = "";
    decl.members.forEach(member => {
        if (member.type == "attribute") {
            if (member.special == "static") {
                console.log(`Static attributes are not supported: ${decl.name}.${member.name}`);
                return;
            }
            afterOutput += `sproc [${namePrefix}${decl.name}] ${toSnakeCase(member.name)} -> `;
            afterOutput += handleInterfaceAttribute(member, `${namePrefix}${decl.name}`);
        } else if (member.type == "const") {
            if (!INT_TYPES.includes(member.idlType.idlType)) {
                console.log(`Non-int constants are not supported: ${decl.name}.${member.name}`);
                return;
            }
            let value = member.value.value;
            if (member.value.type == "boolean") value = member.value.value == "true" ? 1 : 0; 
            afterOutput += `const ${namePrefix}${decl.name}.${member.name} ${value};\n`;
        } else if (member.type == "operation") {
            if (member.special == "static" || member.special == "stringifier") { // TODO: Make getters with an int param implement __index__
                console.log(`Static attributes and stringifiers are not supported: ${decl.name}.${member.name}`);
                return;
            }
            afterOutput += `sproc [${namePrefix}${decl.name}] ${toSnakeCase(member.name)} `;
            let argumentsLoading = "";
            let argumentsPassing = "  ";
            let i = 0
            for (; i < member.arguments.length; i++) {
                if (member.arguments[i].optional) break;
                if (member.arguments[i].variadic)
                    console.log(`Variadic arguments are not supported, treating it as a regular argument: ${decl.name}.${member.name}`);
                afterOutput += typeToCont(member.arguments[i].idlType, false);
                argumentsLoading += loadIntoJS(member.arguments[i].idlType, i);
                argumentsPassing += `arg${i} `;
            }
            afterOutput += typeToCont(member.idlType, true);
            afterOutput += ":\n";
            afterOutput += argumentsLoading;
            afterOutput += argumentsPassing;
            afterOutput += `"${member.name}" self.call_method${i}\n`;
            afterOutput += loadFromJS(member.idlType);
            afterOutput += "end\n";
        } else
            console.log(`Unknown member type: ${member.type} for ${decl.name}.${member.name}`);
    });
    return [output, afterOutput];
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
    const res = declarations.reduce((prev, elem) => [prev[0] + elem[0], prev[1] + elem[1]]);
    writeFileSync(process.argv[3], res[0] + res[1])
    console.log("Finished");
}

main();