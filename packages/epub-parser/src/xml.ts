export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text?: string;
}

const TEXT_NODE = "#text";

export function parseXml(xml: string): XmlNode | null {
  const sanitized = xml.replace(/\r\n/g, "\n");
  const root: XmlNode = { name: "__root__", attributes: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tokenRegex = /<[^>]+>|[^<]+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(sanitized))) {
    const token = match[0];
    if (token.startsWith("<?") || token.startsWith("<!")) {
      continue;
    }

    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }

    if (token.startsWith("<")) {
      const isSelfClosing = token.endsWith("/>");
      const tagContent = token.slice(1, token.length - (isSelfClosing ? 2 : 1)).trim();
      const [name, ...attrParts] = splitWhitespace(tagContent);
      if (!name) continue;

      const node: XmlNode = {
        name: normalizeName(name),
        attributes: parseAttributes(attrParts.join(" ")),
        children: [],
      };

      const parent = stack[stack.length - 1];
      parent.children.push(node);

      if (!isSelfClosing) {
        stack.push(node);
      }
      continue;
    }

    const text = token.trim();
    if (!text) {
      continue;
    }

    const parent = stack[stack.length - 1];
    const existingTextChild = parent.children.find(child => child.name === TEXT_NODE);
    if (existingTextChild) {
      existingTextChild.text = `${existingTextChild.text ?? ""}${text}`;
    } else {
      parent.children.push({ name: TEXT_NODE, attributes: {}, children: [], text });
    }
  }

  return root.children[0] ?? null;
}

export function findNodes(node: XmlNode | null, name: string): XmlNode[] {
  if (!node) return [];
  const normalized = normalizeName(name);
  const result: XmlNode[] = [];

  function traverse(current: XmlNode) {
    if (current.name === normalized) {
      result.push(current);
    }
    for (const child of current.children) {
      if (child.name !== TEXT_NODE) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return result;
}

export function findFirst(node: XmlNode | null, name: string): XmlNode | undefined {
  return findNodes(node, name)[0];
}

export function getText(node: XmlNode | null): string | undefined {
  if (!node) return undefined;
  return node.children
    .filter(child => child.name === TEXT_NODE && child.text)
    .map(child => child.text!.trim())
    .join(" ")
    .trim() || undefined;
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(input))) {
    const [, key, , doubleQuoted, singleQuoted] = match;
    attrs[normalizeName(key)] = (doubleQuoted ?? singleQuoted ?? "").trim();
  }
  return attrs;
}

function splitWhitespace(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}
