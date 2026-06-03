import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function getPath(value, path) {
    if (!path) {
        return value;
    }
    return String(path).split(".").reduce((current, key) => {
        if (current === undefined || current === null) {
            return undefined;
        }
        if (key === "length" && Array.isArray(current)) {
            return current.length;
        }
        if (Array.isArray(current) && /^\d+$/.test(key)) {
            return current[Number(key)];
        }
        return current[key];
    }, value);
}

export function resolveTokens(text, context) {
    if (typeof text !== "string") {
        return text;
    }
    return text.replace(/\$\{([^}]+)\}/g, (_match, path) => {
        const normalized = path.replace(/^commands\./, "command.");
        const value = getPath(context, normalized);
        return value === undefined || value === null ? "" : String(value);
    });
}

function relPath(root, path, context) {
    const resolved = resolve(root, resolveTokens(path, context));
    return resolved;
}

function commandAt(commands, index) {
    const command = commands[Number(index)];
    if (!command) {
        throw new Error(`missing command ${index}`);
    }
    return command;
}

function compareValue(actual, assertion) {
    if (Object.prototype.hasOwnProperty.call(assertion, "equals")) {
        return Object.is(actual, assertion.equals);
    }
    if (Object.prototype.hasOwnProperty.call(assertion, "includes")) {
        return Array.isArray(actual)
            ? actual.includes(assertion.includes)
            : String(actual).includes(String(assertion.includes));
    }
    if (assertion.matches) {
        return new RegExp(assertion.matches).test(String(actual));
    }
    if (Object.prototype.hasOwnProperty.call(assertion, "gte")) {
        return Number(actual) >= assertion.gte;
    }
    if (Object.prototype.hasOwnProperty.call(assertion, "gt")) {
        return Number(actual) > assertion.gt;
    }
    if (Object.prototype.hasOwnProperty.call(assertion, "lte")) {
        return Number(actual) <= assertion.lte;
    }
    if (Object.prototype.hasOwnProperty.call(assertion, "lt")) {
        return Number(actual) < assertion.lt;
    }
    if (assertion.truthy) {
        return Boolean(actual);
    }
    return Boolean(actual);
}

function expectedText(assertion) {
    if (Object.prototype.hasOwnProperty.call(assertion, "equals")) {
        return `equals ${JSON.stringify(assertion.equals)}`;
    }
    if (Object.prototype.hasOwnProperty.call(assertion, "includes")) {
        return `includes ${JSON.stringify(assertion.includes)}`;
    }
    if (assertion.matches) {
        return `matches ${assertion.matches}`;
    }
    for (const op of ["gte", "gt", "lte", "lt"]) {
        if (Object.prototype.hasOwnProperty.call(assertion, op)) {
            return `${op} ${assertion[op]}`;
        }
    }
    if (assertion.truthy) {
        return "truthy";
    }
    return "passes";
}

function friction(scenario, assertion, actual, error = "") {
    return {
        scenarioId: scenario.id,
        phase: assertion.phase || scenario.phase || "assert",
        command: assertion.command === undefined ? "" : `command[${assertion.command}]`,
        expected: assertion.expect || expectedText(assertion),
        actual: error || String(actual),
        type: assertion.frictionType || "assertion",
        classification: assertion.classification || scenario.classification || "unknown",
        candidateHosArea: assertion.candidateHosArea || scenario.candidateHosArea || "",
        reproducible: true
    };
}

function parsedCommandJson(command) {
    if (command.json !== undefined) {
        return command.json;
    }
    try {
        return JSON.parse(command.stdout);
    } catch {
        return undefined;
    }
}

function assertJsonField(scenario, assertion, commands) {
    const command = commandAt(commands, assertion.command);
    const actual = getPath(parsedCommandJson(command), assertion.path);
    return compareValue(actual, assertion)
        ? null
        : friction(scenario, assertion, JSON.stringify(actual));
}

function assertJsonArrayObjectIncludes(scenario, assertion, commands) {
    const command = commandAt(commands, assertion.command);
    const actual = getPath(parsedCommandJson(command), assertion.path);
    const ok = Array.isArray(actual)
        && actual.some((item) => Object.is(getPath(item, assertion.field), assertion.equals));
    return ok ? null : friction(scenario, assertion, JSON.stringify(actual));
}

function assertFile(scenario, assertion, fixtureDir, context) {
    const path = relPath(fixtureDir, assertion.path, context);
    const exists = existsSync(path);
    if (assertion.type === "fileExists") {
        return exists ? null : friction(scenario, assertion, path);
    }
    if (assertion.type === "fileMissing") {
        return !exists ? null : friction(scenario, assertion, path);
    }
    if (!exists) {
        return friction(scenario, assertion, path, "file missing");
    }
    const text = readFileSync(path, "utf8");
    if (assertion.type === "fileContains") {
        return text.includes(assertion.text) ? null : friction(scenario, assertion, path);
    }
    if (assertion.type === "fileNotContains") {
        return !text.includes(assertion.text) ? null : friction(scenario, assertion, path);
    }
    if (assertion.type === "fileEquals") {
        return text === assertion.text ? null : friction(scenario, assertion, JSON.stringify(text));
    }
    return null;
}

function assertPathFromCommand(scenario, assertion, commands, context) {
    const command = commandAt(commands, assertion.command);
    const value = getPath(parsedCommandJson(command), assertion.path);
    const path = resolve(resolveTokens(value, context));
    const exists = existsSync(path);
    return exists ? null : friction(scenario, assertion, path);
}

function assertJsonFileField(scenario, assertion, commands, context) {
    const command = commandAt(commands, assertion.command);
    const rawPath = getPath(parsedCommandJson(command), assertion.path);
    const file = resolve(resolveTokens(rawPath, context));
    if (!existsSync(file)) {
        return friction(scenario, assertion, file, "json file missing");
    }
    const actual = getPath(JSON.parse(readFileSync(file, "utf8")), assertion.jsonPath);
    return compareValue(actual, assertion)
        ? null
        : friction(scenario, assertion, JSON.stringify(actual));
}

function assertLocalJsonFileField(scenario, assertion, fixtureDir, context) {
    const file = relPath(fixtureDir, assertion.path, context);
    if (!existsSync(file)) {
        return friction(scenario, assertion, file, "json file missing");
    }
    const actual = getPath(JSON.parse(readFileSync(file, "utf8")), assertion.jsonPath);
    return compareValue(actual, assertion)
        ? null
        : friction(scenario, assertion, JSON.stringify(actual));
}

function assertCommandExit(scenario, assertion, commands) {
    const command = commandAt(commands, assertion.command);
    const expected = assertion.status ?? 0;
    return command.status === expected
        ? null
        : friction(scenario, assertion, `exit ${command.status}: ${command.stderr}`);
}

// For commands whose output is text, not JSON (compose, dispatch).
function assertCommandStdout(scenario, assertion, commands) {
    const command = commandAt(commands, assertion.command);
    return String(command.stdout).includes(assertion.text)
        ? null
        : friction(scenario, assertion, String(command.stdout).slice(0, 160));
}

function assertFileFromCommandNotContains(scenario, assertion, commands, context) {
    const command = commandAt(commands, assertion.command);
    const rawPath = getPath(parsedCommandJson(command), assertion.path);
    const file = resolve(resolveTokens(rawPath, context));
    if (!existsSync(file)) {
        return friction(scenario, assertion, file, "file missing");
    }
    const text = readFileSync(file, "utf8");
    return !text.includes(assertion.text) ? null : friction(scenario, assertion, file);
}

function assertFileFromCommandContains(scenario, assertion, commands, context) {
    const command = commandAt(commands, assertion.command);
    const rawPath = getPath(parsedCommandJson(command), assertion.path);
    const file = resolve(resolveTokens(rawPath, context));
    if (!existsSync(file)) {
        return friction(scenario, assertion, file, "file missing");
    }
    const text = readFileSync(file, "utf8");
    return text.includes(assertion.text) ? null : friction(scenario, assertion, file);
}

export function evaluateAssertions({ scenario, fixtureDir, commands, context = {} }) {
    const frictions = [];
    const fullContext = { ...context, command: commands.map((item) => item.json ?? item.stdout) };

    for (const assertion of scenario.assertions || []) {
        try {
            const failure = (() => {
                if (assertion.type === "commandExit") {
                    return assertCommandExit(scenario, assertion, commands);
                }
                if (assertion.type === "commandStdoutContains") {
                    return assertCommandStdout(scenario, assertion, commands);
                }
                if (assertion.type === "jsonField" || assertion.type === "jsonArrayIncludes") {
                    return assertJsonField(scenario, assertion, commands);
                }
                if (assertion.type === "jsonArrayObjectIncludes") {
                    return assertJsonArrayObjectIncludes(scenario, assertion, commands);
                }
                if (assertion.type === "commandPathExists") {
                    return assertPathFromCommand(scenario, assertion, commands, fullContext);
                }
                if (assertion.type === "jsonFileField") {
                    return assertJsonFileField(scenario, assertion, commands, fullContext);
                }
                if (assertion.type === "fileJsonField") {
                    return assertLocalJsonFileField(scenario, assertion, fixtureDir, fullContext);
                }
                if (assertion.type === "fileFromCommandNotContains") {
                    return assertFileFromCommandNotContains(scenario, assertion, commands, fullContext);
                }
                if (assertion.type === "fileFromCommandContains") {
                    return assertFileFromCommandContains(scenario, assertion, commands, fullContext);
                }
                if (assertion.type.startsWith("file")) {
                    return assertFile(scenario, assertion, fixtureDir, fullContext);
                }
                return friction(scenario, assertion, assertion.type, "unknown assertion type");
            })();
            if (failure) {
                frictions.push(failure);
            }
        } catch (error) {
            frictions.push(friction(scenario, assertion, "", error.message));
        }
    }
    return frictions;
}
