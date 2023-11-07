const { parse } = require("webidl2");
const process = require('node:process');
const { readFileSync, writeFileSync } = require("fs");

const namePrefix = process.argv[4];

const INT_TYPES = [
    "byte",           "short",          "long",          "long long", 
    "octet", "unsigned short", "unsigned long", "unsigned long long",
    "boolean"
];
const STRING_TYPES = ["DOMString", "ByteString", "USVString"];
const FORCE_JS_VALUE = [
    "any", "object", "symbol",
    "DOMHighResTimeStamp", "bigint", "float", "unrestricted float", "double", "unrestricted double",
];

function isUpperCase(str) {
    return str === str.toUpperCase();
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
            if (i === 0 || i === originalName.length - 1)
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
    if (member.idlType.union || FORCE_JS_VALUE.includes(member.idlType.idlType)) {
        output += `JSValue:
  "${member.name}" self.get
end\n`;
        if (!member.readonly)
            output += `sproc [${owner}] !${toSnakeCase(member.name)} JSValue:
  "${member.name}" self.set
end\n`;
    } else if (INT_TYPES.includes(member.idlType.idlType)) {
        if (member.idlType.nullable)
            console.log(`Nullable ints are not supported, intepreting as a regular int in ${owner}.${member.name}`);
        output += `int:
  "${member.name}" self.get JSInt.unwrap dup .value swap .free
end\n`;
        if (!member.readonly)
            output += `sproc [${owner}] !${toSnakeCase(member.name)} int:
  init var value JSInt
  value "${member.name}" self.set
end\n`;
    } else if (STRING_TYPES.includes(member.idlType.idlType)) {
        if (member.idlType.nullable) {
            output += `@str:
  "${member.name}" self.get let res;
  if JSTypes.Null res.type == do
    res.free -1 NULL
  else
    res JSString.unwrap let string; string.value string free
  end
end\n`;
            if (!member.readonly)
                output += `nproc [${owner}] !${toSnakeCase(member.name)} @str:
  if data NULL ptr== do
    init var null JSNull null (JSValue)
  else
    len data init var value JSString value (JSValue)
  end
  "${member.name}" self.set
end\n`;
        }
        else {
            output += `@str:
  "${member.name}" self.get JSString.unwrap let string; string.value string free
end\n`;
            if (!member.readonly)
                output += `sproc [${owner}] !${toSnakeCase(member.name)} @str:
  init var value JSString
  value "${member.name}" self.set
end\n`;
        }
    } else {
        if (member.idlType.nullable) {
            output += `${namePrefix}${member.idlType.idlType}:
  "${member.name}" self.get let res;
  if JSTypes.Null res.type == do
    res.free NULL
  else
    res ${namePrefix}${member.idlType.idlType}.full_unwrap
  end
end\n`;
            if (!member.readonly)
                output += `nproc [${owner}] !${toSnakeCase(member.name)} ${namePrefix}${member.idlType.idlType} val:
  if NULL val ptr== do
    init var null JSNull
    null (JSValue)
  else val (JSValue) end
  "${member.name}" self.set
end\n`;
        } else {
            output += `${namePrefix}${member.idlType.idlType}:
  "${member.name}" self.get ${namePrefix}${member.idlType.idlType}.full_unwrap
end\n`;
            if (!member.readonly)
                output += `sproc [${owner}] !${toSnakeCase(member.name)} ${namePrefix}${member.idlType.idlType}:
  "${member.name}" self.set
end\n`;
        }
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
        console.log(`Generic types are not supported: ${type.generic}`);
        return "";
    }
    let prefix = isReturn ? "-> " : ""; 
    if (type.union || FORCE_JS_VALUE.includes(type.idlType))
        return prefix + "JSValue ";
    else if (INT_TYPES.includes(type.idlType))
        return prefix + "int ";
    else if (STRING_TYPES.includes(type.idlType))
        return prefix + "@str ";
    else if (type.idlType === "undefined")
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
        console.log(`Generic types are not supported: ${type.generic}`);
        return "";
    }
    if (INT_TYPES.includes(type.idlType)) {
        if (type.nullable)
            console.log(`Nullable ints are not supported, intepreting as a regular int: ${type.idlType}`);
        return `  init var arg${argNum} JSInt\n`;
    }
    else if (STRING_TYPES.includes(type.idlType))
        if (type.nullable)
            return `  if dup NULL ptr!= do
    init var arg${argNum} JSString
  else
    drop drop arg${argNum} (JSNull) .__init__
  end\n`;
        else
            return `  init var arg${argNum} JSString\n`;
    else
        if (type.nullable)
            return `  if dup NULL ptr== do
    drop init var null${argNum} JSNull null${argNum} (JSValue)
  end let arg${argNum};\n`;
        else
            return `  let arg${argNum};\n`;
}

/**
 * 
 * @param {WebIDL2.IDLTypeDescription} type
 */
function loadFromJS(type) {
    if (type.generic) {
        console.log(`Generic types are not supported: ${type.generic}`);
        return "";
    }
    if (type.union || FORCE_JS_VALUE.includes(type.idlType))
        return "";
    else if (INT_TYPES.includes(type.idlType)) {
        if (type.nullable)
            console.log(`Nullable ints are not supported, intepreting as a regular int: ${type.idlType}`);
        return "  JSInt.unwrap let res; res.value res.free\n";
    } else if (STRING_TYPES.includes(type.idlType))
        if (type.nullable)
            return `  let res;
  if JSTypes.Null res.type == do
    res.free -1 NULL
  else
    res JSString.unwrap let string; string.value string free
  end\n`;
        else return `JSString.unwrap let res; res.value res free\n`;
    else if (type.idlType === "undefined")
        return "  .free\n";
    else
        if (type.nullable)
            return `  let res;
  if JSTypes.Null res.type == do
    res.free NULL
  else
    res ${namePrefix}${type.idlType}.full_unwrap
  end\n`;
        else
            return "";
}

/**
 * 
 * @param {WebIDL2.OperationMemberType | WebIDL2.ConstructorMemberType} member 
 * @param {string} declName
 * @param {number} argCount  
 * @returns {[string, string, string]}
 */
function handleArguments(member, argCount, declName) {
    let argumentTypes = "";
    let argumentsPassing = "  ";
    for (let i = 0; i < argCount; i++) {
        if (member.arguments[i].variadic)
            console.log(`Variadic arguments are not supported, treating it as a regular argument: ${declName}.${member.name}`);
        argumentTypes += typeToCont(member.arguments[i].idlType, false);
        argumentsPassing += `arg${i} `;
    }
    let argumentsLoading = "";
    for (let j = argCount - 1; j >= 0; j--)
        argumentsLoading += loadIntoJS(member.arguments[j].idlType, j);
    return [argumentTypes, argumentsLoading, argumentsPassing];
}
/**
 * @param {WebIDL2.IDLInterfaceMemberType} member 
 * @param {Record<string, WebIDL2.IDLTypeDescription>} typedefs 
 */
function handleTypedefs(member, typedefs) {
    if (member.type === "attribute" || member.type === "const") {
        if (member.idlType.idlType in typedefs)
            member.idlType = typedefs[member.idlType.idlType];
    } else if (member.type === "constructor" || member.type === "operation") {
        if (member.type === "operation" && member.special !== "stringifier" && member.idlType.idlType in typedefs)
            member.idlType = typedefs[member.idlType.idlType];
        member.arguments.forEach((arg, index) => {
            if (arg.idlType.idlType in typedefs)
                member.arguments[index].idlType = typedefs[arg.idlType.idlType]
        });
    } else
        console.log(`Unsupported member type for handleTypedefs: ${member.type}`); 
}

/**
 * @param {WebIDL2.InterfaceType} decl
 * @param {Record<string, WebIDL2.IDLInterfaceMixinMemberType[]>} mixins
 * @param {Record<string, string[]>} includes
 * @param {Record<string, WebIDL2.IDLTypeDescription>} typedefs    
 * @returns {[string, string]}
 */
function handleInterface(decl, mixins, includes, typedefs) {
    let parent = decl.inheritance ? `${namePrefix}${decl.inheritance}` : "JSObject";
    let output = `struct (${parent}) ${namePrefix}${decl.name}
  static nproc unwrap JSObject self -> ${namePrefix}${decl.name}:
    "${decl.name}" self.unwrap_as (${namePrefix}${decl.name})
  end
  proc full_unwrap JSValue -> ${namePrefix}${decl.name}:
    JSObject.unwrap ${namePrefix}${decl.name}.unwrap
  end
end\n`;
    let afterOutput = "";
    let members = decl.members;
    if (decl.name in includes)
        includes[decl.name].forEach(mixinName => {
            if (mixinName in mixins)
                members.push(...mixins[mixinName]);
            else console.log(`Included mixin not found: ${mixinName}`);
        });
    members.forEach(member => {
        handleTypedefs(member, typedefs);
        if (member.type === "attribute") {
            if (member.special === "static") {
                console.log(`Static attributes are not supported: ${decl.name}.${member.name}`);
                return;
            }
            afterOutput += `sproc [${namePrefix}${decl.name}] ${toSnakeCase(member.name)} -> `;
            afterOutput += handleInterfaceAttribute(member, `${namePrefix}${decl.name}`);
        } else if (member.type === "const") {
            if (!INT_TYPES.includes(member.idlType.idlType)) {
                console.log(`Non-int constants are not supported: ${decl.name}.${member.name}`);
                return;
            }
            let value = member.value.value;
            if (member.value.type === "boolean") value = member.value.value === "true" ? 1 : 0; 
            afterOutput += `const ${namePrefix}${decl.name}.${member.name} ${value};\n`;
        } else if (member.type === "operation") {
            if (member.special === "static") { // TODO: Make getters with an int param implement __index__
                console.log(`Static attributes are not supported: ${decl.name}.${member.name}`);
                return;
            }
            if (member.special === "stringifier") return;
            let requiredArgsCount = member.arguments.findIndex((val) => val.optional);
            requiredArgsCount = requiredArgsCount >= 0 ? requiredArgsCount : member.arguments.length;
            for (let argCount = requiredArgsCount; argCount <= member.arguments.length; argCount++) {
                let variantSuffix = argCount === requiredArgsCount ? "" : argCount;
                afterOutput += `sproc [${namePrefix}${decl.name}] ${toSnakeCase(member.name)}${variantSuffix} `;
                const [argumentsTypes, argumentsLoading, argumentsPassing] = handleArguments(member, argCount, decl.name);
                afterOutput += argumentsTypes;
                afterOutput += typeToCont(member.idlType, true);
                afterOutput += ":\n";
                afterOutput += argumentsLoading;
                afterOutput += argumentsPassing;
                afterOutput += `"${member.name}" self.call_method${argCount}\n`;
                afterOutput += loadFromJS(member.idlType);
                afterOutput += "end\n";
            }
        } else if (member.type === "constructor") {
            let requiredArgsCount = member.arguments.findIndex((val) => val.optional);
            requiredArgsCount = requiredArgsCount >= 0 ? requiredArgsCount : member.arguments.length - 1;
            for (let argCount = requiredArgsCount; argCount <= member.arguments.length; argCount++) {
                let variantSuffix = argCount === requiredArgsCount ? "" : argCount;
                afterOutput += `sproc [${namePrefix}${decl.name}] __init${variantSuffix}__ `;
                const [argumentsTypes, argumentsLoading, argumentsPassing] = handleArguments(member, argCount, decl.name);
                afterOutput += argumentsTypes;
                afterOutput += ":\n";
                afterOutput += `  JSTypes.Object !self.type
  var args [${argCount + 1}] JSValue
  NULL ${argCount} args *[] !\n`
                afterOutput += argumentsLoading;
                afterOutput += argumentsPassing + "\n";
                for (let i = argCount - 1; i >= 0; i--)
                    afterOutput += `  ${i} args *[] !\n`
                afterOutput += `  args ([DYNAMIC_ARRAY_SIZE]) JSValue
  "${decl.name}" JSObject.construct dup .object_id !self.object_id free
end\n`;
            }
        } else
            console.log(`Unknown member type: ${member.type} for ${decl.name}.${member.name}`);
    });
    return [output, afterOutput];
}

/**
 * 
 * @param {WebIDL2.IDLRootType} decl
 * @param {Record<string, WebIDL2.IDLInterfaceMixinMemberType[]>} mixins
 * @param {Record<string, string[]>} includes   
 * @param {Record<string, WebIDL2.IDLTypeDescription>} typedefs 
 * @returns [string, string]
 */
function handleDeclaration(decl, mixins, includes, typedefs) {
    if (decl.type === "interface")
        return handleInterface(decl, mixins, includes, typedefs);
    else if (decl.type === "enum") {
        let output = "";
        decl.values.forEach(val => {
            output += `proc ${namePrefix}${decl.name}.${val.value} -> @str: "${val.value}" end\n`;
        });
        return [output, ""];
    }
    else if (decl.type === "interface mixin")
        mixins[decl.name] = decl.members;
    else if (decl.type === "includes")
        if (decl.target in includes)
            includes[decl.target].push(decl.includes);
        else
            includes[decl.target] = [decl.includes];
    else if (decl.type == "typedef")
        typedefs[decl.name] = decl.idlType;
    else
        console.log(`Unknown declaration type: ${decl.type} for ${decl.name}`);
    return ["", ""];
}

function main() {
    let mixins = {};
    let includes = {};
    let typedefs = {};
    const tree = parse(readFileSync(process.argv[2], "utf-8"));
    
    const declarations = tree.map((x) => handleDeclaration(x, mixins, includes, typedefs));
    const res = declarations.reduce((prev, elem) => [prev[0] + elem[0], prev[1] + elem[1]]);
    writeFileSync(process.argv[3], res[0] + res[1])
    console.log("Finished");
}

main();