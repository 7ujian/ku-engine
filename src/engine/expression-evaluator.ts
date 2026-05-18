import type { PropertyMap } from './types.js';
import type { SceneTree } from './scene-tree.js';
import { resolveSymbol, type ResolverContext } from './resolve-symbol.js';

type TokenType = 'NUMBER' | 'IDENT' | 'CROSS_REF' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

export function evaluateExpression(
  template: unknown,
  properties: PropertyMap,
  context: Record<string, unknown> = {},
  tree?: SceneTree,
): unknown {
  if (typeof template !== 'string') return template;
  if (!template.includes('{{')) return template;

  const resolverCtx: ResolverContext = { properties, context, tree };

  // If the entire template is a single expression, return raw value
  const singleMatch = template.match(/^\{\{(.+?)\}\}$/);
  if (singleMatch) {
    return parseAndEval(singleMatch[1].trim(), resolverCtx);
  }

  // Otherwise interpolate into string
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    return String(parseAndEval(expr.trim(), resolverCtx));
  });
}

function parseAndEval(expr: string, ctx: ResolverContext): unknown {
  try {
    const tokens = tokenize(expr);
    const parser = new ExprParser(tokens, ctx);
    return parser.parse();
  } catch {
    return undefined;
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    // Cross-node reference: /nodeId/prop or /nodeId/prop.nested
    if (input[i] === '/' && i + 1 < input.length && /[\w]/.test(input[i + 1])) {
      let j = i + 1;
      // Consume nodeId
      while (j < input.length && /[\w]/.test(input[j])) j++;
      // Expect /
      if (j < input.length && input[j] === '/') {
        j++;
        const start = j;
        // Consume prop path (word chars and dots)
        while (j < input.length && /[\w.]/.test(input[j])) j++;
        tokens.push({ type: 'CROSS_REF', value: input.slice(i, j) });
        i = j;
        continue;
      }
      // Not a cross-node ref — treat / as division
      tokens.push({ type: 'OP', value: '/' });
      i++;
      continue;
    }

    // Number literal
    if (/\d/.test(input[i]) || (input[i] === '.' && i + 1 < input.length && /\d/.test(input[i + 1]))) {
      let j = i;
      while (j < input.length && /[\d.]/.test(input[j])) j++;
      tokens.push({ type: 'NUMBER', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Identifier (potential function name, or dotted path like velocity.x)
    if (/[\w]/.test(input[i])) {
      let j = i;
      while (j < input.length && /[\w.]/.test(input[j])) j++;
      // Remove trailing dot if any
      let value = input.slice(i, j);
      if (value.endsWith('.')) { j--; value = input.slice(i, j); }
      tokens.push({ type: 'IDENT', value });
      i = j;
      continue;
    }

    // Operators
    if ('+-*/%'.includes(input[i])) {
      tokens.push({ type: 'OP', value: input[i] });
      i++;
      continue;
    }

    // Parens
    if (input[i] === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (input[i] === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }

    // Comma
    if (input[i] === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }

    // Skip unknown chars
    i++;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

class ExprParser {
  private tokens: Token[];
  private pos = 0;
  private ctx: ResolverContext;

  constructor(tokens: Token[], ctx: ResolverContext) {
    this.tokens = tokens;
    this.ctx = ctx;
  }

  parse(): unknown { return this.additive(); }

  private additive(): unknown {
    let left = this.multiplicative();
    while (this.checkOp('+') || this.checkOp('-')) {
      const op = this.advance().value;
      const right = this.multiplicative();
      if (typeof left === 'number' && typeof right === 'number') {
        left = op === '+' ? left + right : left - right;
      } else if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
        left = String(left) + String(right);
      }
    }
    return left;
  }

  private multiplicative(): unknown {
    let left = this.unary();
    while (this.checkOp('*') || this.checkOp('/') || this.checkOp('%')) {
      const op = this.advance().value;
      const right = this.unary();
      if (typeof left === 'number' && typeof right === 'number') {
        switch (op) {
          case '*': left = left * right; break;
          case '/': left = left / right; break;
          case '%': left = left % right; break;
        }
      }
    }
    return left;
  }

  private unary(): unknown {
    if (this.checkOp('-')) {
      this.advance();
      const val = this.unary();
      return typeof val === 'number' ? -val : val;
    }
    return this.primary();
  }

  private primary(): unknown {
    // Number literal
    if (this.checkType('NUMBER')) {
      return parseFloat(this.advance().value);
    }

    // Function call or identifier
    if (this.checkType('IDENT')) {
      const name = this.advance().value;
      if (this.checkType('LPAREN')) {
        return this.funcCall(name);
      }
      return resolveSymbol(name, this.ctx);
    }

    // Cross-node reference
    if (this.checkType('CROSS_REF')) {
      const ref = this.advance().value;
      return resolveSymbol(ref, this.ctx);
    }

    // Parenthesized expression
    if (this.checkType('LPAREN')) {
      this.advance();
      const val = this.additive();
      this.expect('RPAREN');
      return val;
    }

    return undefined;
  }

  private funcCall(name: string): unknown {
    this.expect('LPAREN');
    const args: unknown[] = [];
    if (!this.checkType('RPAREN')) {
      args.push(this.additive());
      while (this.checkType('COMMA')) {
        this.advance();
        args.push(this.additive());
      }
    }
    this.expect('RPAREN');

    switch (name) {
      case 'random': {
        const min = args[0] as number ?? 0;
        const max = args[1] as number ?? 1;
        return min + Math.random() * (max - min);
      }
      case 'min': return Math.min(args[0] as number ?? 0, args[1] as number ?? 0);
      case 'max': return Math.max(args[0] as number ?? 0, args[1] as number ?? 0);
      case 'abs': return Math.abs(args[0] as number ?? 0);
      case 'floor': return Math.floor(args[0] as number ?? 0);
      case 'ceil': return Math.ceil(args[0] as number ?? 0);
      default: return undefined;
    }
  }

  private checkType(type: TokenType): boolean {
    return this.pos < this.tokens.length && this.tokens[this.pos].type === type;
  }

  private checkOp(op: string): boolean {
    return this.pos < this.tokens.length && this.tokens[this.pos].type === 'OP' && this.tokens[this.pos].value === op;
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): void {
    if (this.pos < this.tokens.length && this.tokens[this.pos].type === type) {
      this.pos++;
    }
  }
}
