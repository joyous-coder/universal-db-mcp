import { Faker, zh_CN, en, base } from '@faker-js/faker';
import type { ColumnInfo } from '../types/adapter.js';
import { resolveTemplate } from './template-resolver.js';

export interface GenerateContext {
  overrides?: Record<string, unknown>;
  rule?: any;
  rowContext?: Record<string, unknown>;
}

export class SampleDataGenerator {
  private faker: any;
  private sequenceCounter: number = 0;
  private rngSeed: number;

  constructor(options?: { seed?: number }) {
    this.rngSeed = options?.seed ?? Date.now();
    try {
      this.faker = new Faker({ locale: [zh_CN, en, base] });
      this.faker.seed(this.rngSeed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法加载或初始化 @faker-js/faker: ${message}`);
    }
  }

  /**
   * Generate a value for a single column.
   * Returns undefined for auto-increment primary keys.
   */
  generateValue(column: ColumnInfo, context: GenerateContext = {}, rowIndex: number = 0): unknown {
    if (context.overrides?.[column.name] !== undefined) {
      return context.overrides[column.name];
    }

    if (context.rule) {
      return this.applyRule(column, context.rule, context, rowIndex);
    }

    const heuristic = this.matchHeuristic(column);
    if (heuristic !== null) return heuristic;

    return this.fallbackByType(column);
  }

  private applyRule(column: ColumnInfo, rule: any, context: GenerateContext, rowIndex: number): unknown {
    const gen = rule.generate;
    if (!gen) return this.fallbackByType(column);

    switch (gen.type) {
      case 'fixed':
        return gen.value;
      case 'range': {
        const value = this.faker.number.float({
          min: gen.min,
          max: gen.max,
          fractionDigits: gen.decimals ?? 0,
        });
        return gen.decimals ? value : Math.floor(value);
      }
      case 'pattern':
        return resolveTemplate(
          gen.template,
          context.rowContext || {},
          ++this.sequenceCounter,
          rowIndex,
          new Date()
        );
      case 'faker':
        return this.callFakerMethod(gen.method, gen.args);
      case 'choice':
        return this.faker.helpers.arrayElement(gen.values);
      case 'sequence':
        return (gen.start ?? 1) + rowIndex * (gen.step ?? 1);
      case 'regex':
        return this.faker.string.alpha(10);
      case 'null':
        return null;
      case 'skip':
        return undefined;
      case 'enum':
        return context.rowContext?.[column.name + '_enum_value'] ?? null;
      default:
        return this.fallbackByType(column);
    }
  }

  private callFakerMethod(method: string, args?: any[]): unknown {
    const allowed = [
      'internet.email', 'internet.ip', 'internet.url', 'internet.userName',
      'person.fullName', 'person.firstName', 'person.lastName',
      'phone.number', 'location.city', 'location.streetAddress',
      'location.zipCode', 'string.uuid', 'string.numeric',
      'number.int', 'number.float', 'date.recent', 'date.past',
      'lorem.sentence', 'lorem.word', 'datatype.boolean',
    ];
    const parts = method.split('.');
    if (parts.length !== 2 || !allowed.includes(method)) return null;
    const obj = this.faker[parts[0]];
    if (!obj || typeof obj[parts[1]] !== 'function') return null;
    try {
      return obj[parts[1]](...(args || []));
    } catch {
      return null;
    }
  }

  private matchHeuristic(column: ColumnInfo): unknown | null {
    const name = column.name.toLowerCase();
    if (/^(password|passwd|pwd|secret|token|api_?key|access_?token|refresh_?token)$/i.test(name)) return '******';
    if (/^(email|e_?mail|user_?email|contact_?email)$/i.test(name)) return this.faker.internet.email();
    if (/^(name|user_?name|full_?name|real_?name|customer_?name|contact_?name)$/i.test(name)) return this.faker.person.fullName();
    if (/^(phone|mobile|tel|telephone|contact_?phone)$/i.test(name)) return this.faker.phone.number();
    if (/^(address|addr|location|street)$/i.test(name)) return this.faker.location.streetAddress();
    if (/^city$/i.test(name)) return this.faker.location.city();
    if (/^(zip_?code|postal_?code)$/i.test(name)) return this.faker.location.zipCode();
    if (/^(url|website|link|homepage)$/i.test(name)) return this.faker.internet.url();
    if (/^(uuid|guid)$/i.test(name) || column.type.toLowerCase().includes('uuid')) return this.faker.string.uuid();
    if (name === 'id' || /_id$/i.test(name)) return undefined;
    if (/created_?at|created_?time|insert_?time/i.test(name)) return this.faker.date.recent({ days: 90 });
    if (/updated_?at|updated_?time|modify_?time/i.test(name)) return this.faker.date.recent({ days: 30 });
    return null;
  }

  private fallbackByType(column: ColumnInfo): unknown {
    const type = column.type.toLowerCase();
    if (/int|serial|numeric/.test(type)) return this.faker.number.int({ min: 1, max: 10000 });
    if (/float|double|decimal|real/.test(type)) {
      return this.faker.number.float({ min: 0, max: 10000, fractionDigits: 2 });
    }
    if (/date|time/.test(type)) return this.faker.date.recent();
    if (/bool|tinyint\(1\)/.test(type)) return this.faker.datatype.boolean();
    if (/json|jsonb/.test(type)) return JSON.stringify({ sample: true });
    return this.faker.lorem.sentence();
  }
}
