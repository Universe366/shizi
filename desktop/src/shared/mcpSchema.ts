/** 把 MCP 工具的 JSON Schema 展开成参数列表，供对话面板展示。 */

export interface McpToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enumValues: string[];
}

function typeOf(schema: Record<string, unknown>): string {
  const type = schema.type;
  if (Array.isArray(type)) return type.map(String).join(' | ');
  if (typeof type === 'string') {
    if (type === 'array') {
      const items = schema.items as Record<string, unknown> | undefined;
      const itemType = items ? typeOf(items) : '';
      return itemType ? `array<${itemType}>` : 'array';
    }
    return type;
  }
  if (schema.properties) return 'object';
  return 'unknown';
}

export function describeMcpParameters(schema: unknown, depth = 0): McpToolParameter[] {
  if (depth > 2 || !schema || typeof schema !== 'object') return [];
  const record = schema as Record<string, unknown>;
  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = new Set(
    Array.isArray(record.required) ? record.required.map((item) => String(item)) : []
  );
  const rows: McpToolParameter[] = [];
  for (const [name, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object') continue;
    const property = value as Record<string, unknown>;
    rows.push({
      name,
      type: typeOf(property),
      required: required.has(name),
      description: String(property.description || ''),
      enumValues: Array.isArray(property.enum)
        ? property.enum.map((item) => String(item))
        : []
    });
    if (property.properties) {
      for (const child of describeMcpParameters(property, depth + 1)) {
        rows.push({ ...child, name: `${name}.${child.name}` });
      }
    }
    if (property.items && typeof property.items === 'object') {
      for (const child of describeMcpParameters(property.items, depth + 1)) {
        rows.push({ ...child, name: `${name}[].${child.name}` });
      }
    }
  }
  return rows;
}
