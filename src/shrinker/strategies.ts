import type { IRValue } from "../ir/values.js";

/**
 * Returns a list of simplified / shrunk candidates for a given IRValue.
 */
export function shrinkValue(val: IRValue): IRValue[] {
  const results: IRValue[] = [];

  switch (val.kind) {
    case "string": {
      if (val.value.length > 0) {
        // 1. Try empty string
        results.push({ kind: "string", value: "" });
        // 2. Try half length
        const halfLen = Math.floor(val.value.length / 2);
        if (halfLen > 0) {
          results.push({ kind: "string", value: val.value.slice(0, halfLen) });
        }
        // 3. Try removing last character
        results.push({ kind: "string", value: val.value.slice(0, -1) });
      }
      break;
    }

    case "integer": {
      if (val.value !== 0) {
        // 1. Try 0
        results.push({ kind: "integer", value: 0 });
        // 2. Try half
        const half = Math.trunc(val.value / 2);
        if (half !== 0 && half !== val.value) {
          results.push({ kind: "integer", value: half });
        }
        // 3. Decrement towards 0
        results.push({ kind: "integer", value: val.value > 0 ? val.value - 1 : val.value + 1 });
      }
      break;
    }

    case "number": {
      if (val.value !== 0) {
        results.push({ kind: "number", value: 0 });
        results.push({ kind: "number", value: parseFloat((val.value / 2).toFixed(2)) });
      }
      break;
    }

    case "boolean": {
      if (val.value === true) {
        results.push({ kind: "boolean", value: false });
      }
      break;
    }

    case "array": {
      if (val.items.length > 0) {
        // 1. Try empty array
        results.push({ kind: "array", items: [] });
        // 2. Try removing one element at each index
        for (let i = 0; i < val.items.length; i++) {
          const subset = val.items.filter((_, idx) => idx !== i);
          results.push({ kind: "array", items: subset });
        }
        // 3. Try shrinking items in-place
        for (let i = 0; i < val.items.length; i++) {
          const shrunkItems = shrinkValue(val.items[i]);
          for (const shrunk of shrunkItems) {
            const nextItems = [...val.items];
            nextItems[i] = shrunk;
            results.push({ kind: "array", items: nextItems });
          }
        }
      }
      break;
    }

    case "object": {
      const keys = Object.keys(val.fields);
      if (keys.length > 0) {
        // 1. Try removing keys one by one
        for (const key of keys) {
          const copy = { ...val.fields };
          delete copy[key];
          results.push({ kind: "object", fields: copy });
        }
        // 2. Try shrinking property values
        for (const key of keys) {
          const shrunkPropValues = shrinkValue(val.fields[key]);
          for (const shrunk of shrunkPropValues) {
            results.push({
              kind: "object",
              fields: {
                ...val.fields,
                [key]: shrunk,
              },
            });
          }
        }
      }
      break;
    }

    case "null":
    case "date":
    case "date-time":
    case "enum":
      break;
  }

  return results;
}
