import { Faker, zh_CN, en, base } from '@faker-js/faker';
import type { ColumnInfo } from '../types/adapter.js';
import { resolveTemplate } from './template-resolver.js';

export interface GenerateContext {
  overrides?: Record<string, unknown>;
  rule?: any;
  rowContext?: Record<string, unknown>;
  /**
   * v4.0.3.2 Bug #17 fix: 主键列名集合(由 databaseService 从 tableInfo.primaryKeys 传入)。
   * generator 据此识别 PK 列,对不同类型主键采用不同生成策略:
   * - IDENTITY 自增 PK (column.autoIncrement=true): 跳过,让 DB 自填
   * - UUID/CHAR(36) PK: 生成 uuid v4
   * - 其他 PK: 用 context.maxIntPkValues[pkName] (databaseService 提前查的 MAX(pk))
   *   + rowIndex + 1 作为 sequence,避免主键冲突
   */
  primaryKeys?: Set<string> | string[];
  /**
   * v4.0.3.2 Bug #17 fix: 非 IDENTITY INT PK 列的当前 MAX 值。
   * 由 databaseService 在生成前查 `SELECT MAX(pk) FROM table` 注入。
   * 序列从 maxValue + rowIndex + 1 开始,既不冲突也真实。
   */
  maxIntPkValues?: Record<string, number>;
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
   *
   * v4.0.3.2 Bug #17 fix: PK 列处理策略
   * - column.autoIncrement === true → 跳过(IDENTITY 自增,DB 自填)
   * - context.primaryKeys 包含 column.name 且 column 类型是 UUID/CHAR(36) → faker.string.uuid()
   * - 其他 PK → sequence int(避免 unique constraint violation)
   * 非 PK 列走原 heuristic + fallbackByType 路径。
   */
  generateValue(column: ColumnInfo, context: GenerateContext = {}, rowIndex: number = 0): unknown {
    // v5.0.0 Bug #60: case-insensitive override lookup. Oracle adapter returns column
    // names as lowercase but LLM users pass uppercase. Build a lowercase→value map once.
    if (context.overrides) {
      const overrideKey = Object.keys(context.overrides).find(
        k => k.toLowerCase() === column.name.toLowerCase()
      );
      if (overrideKey !== undefined) {
        return context.overrides[overrideKey];
      }
    }

    // v4.0.3.2 Bug #17: adapter 标记了 autoIncrement 列 → 跳过,DB 自填
    if (column.autoIncrement === true) {
      return undefined;
    }

    // v4.0.3.2 Bug #17: PK 列特殊处理(未标记 autoIncrement 时)
    const pkSet = context.primaryKeys instanceof Set
      ? context.primaryKeys
      : new Set(context.primaryKeys ?? []);
    if (pkSet.has(column.name)) {
      const type = column.type.toLowerCase();
      // UUID PK → uuid v4 (列名/类型含 uuid)
      if (type.includes('uuid') || type.includes('uniqueidentifier')) {
        return this.faker.string.uuid();
      }
      // CHAR(36)/VARCHAR2(36)/VARCHAR(36) PK → uuid v4
      // 常见: UUID 存成 char/varchar(36)
      if (/(char|varchar2|varchar|nvarchar|nchar)\(\s*36\s*\)/i.test(column.type)) {
        return this.faker.string.uuid();
      }
      // 其他类型 PK (INT/BIGINT/NUMBER/VARCHAR 等) → 用 context.maxIntPkValues
      // (databaseService 已查 SELECT MAX(pk) FROM table) 作为序列起点
      // + rowIndex + 1,确保不与既有数据冲突且数值真实递增。
      if (type.includes('int') || type.includes('serial') || type.includes('numeric') ||
          type.includes('decimal') || type.includes('number')) {
        const maxVal = context.maxIntPkValues?.[column.name] ?? 0;
        return maxVal + rowIndex + 1;
      }
    }

    if (context.rule) {
      return this.applyRule(column, context.rule, context, rowIndex);
    }

    const heuristic = this.matchHeuristic(column);
    if (heuristic !== null) return this.truncateByColumnType(heuristic, column);

    return this.truncateByColumnType(this.fallbackByType(column), column);
  }

  /**
   * v5.0.1 Bug N14: 从列类型提取最大长度,截断超长字符串。
   * 之前 `fallbackByType` 对所有字符串类型一律返回 `faker.lorem.sentence()`(~70+ 字符),
   * 直接超过 `VARCHAR(20)` 等短列宽,MySQL/PG 报 "Data too long"。
   */
  private truncateByColumnType(value: unknown, column: ColumnInfo): unknown {
    if (typeof value !== 'string') return value;
    const maxLen = this.extractMaxLen(column.type);
    if (maxLen === null) return value;
    return value.length > maxLen ? value.slice(0, maxLen) : value;
  }

  /** 从 column.type 提取 (N) 中的 N,没有显式长度返回 null(无限制)。 */
  private extractMaxLen(type: string): number | null {
    const m = /\(\s*(\d{1,6})\s*\)/.exec(type);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
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
    if (name === 'id' || /_id$/i.test(name)) {
      // v3.2.8 Bug #48 fix: 之前返回 undefined 让 DB auto-fill,但 DM 没有公开的
      // IDENTITY 检测(ALL_TAB_COLUMNS 无 IDENTITY_COLUMN 列),实际 `id INT PRIMARY KEY`
      // 不带 IDENTITY,期待用户提供 int 值。原行为会让 5 行全 null → 静默 0 行
      // 插入(unique constraint violation)。改成生成 sequence int;对真 IDENTITY
      // 列(postgres/mysql 真实 auto-increment)用户值会被 DB 直接使用,语义 OK。
      return this.faker.number.int({ min: 1, max: 100000 });
    }
    if (/created_?at|created_?time|insert_?time/i.test(name)) return this.faker.date.recent({ days: 90 });
    if (/updated_?at|updated_?time|modify_?time/i.test(name)) return this.faker.date.recent({ days: 30 });
    // v5.0.1 Bug N14: status/state/record_status 等枚举列 — 返回短字符串
    // (避免 fallbackByType 给 70+ 字符 lorem sentence → 超过 VARCHAR(20))
    if (/^(status|state|record_?status|order_?status|task_?status|user_?status|account_?status)$/i.test(name)) {
      return this.faker.helpers.arrayElement([
        'active', 'inactive', 'pending', 'completed', 'archived', 'failed', 'paid', 'shipped',
      ]);
    }
    return null;
  }

  private fallbackByType(column: ColumnInfo): unknown {
    const type = column.type.toLowerCase();
    // v4.0.3.2 Bug #17 fix: `number` 是 Oracle/DM/Postgres 通用数值类型名,
    // 之前 regex 只匹配 `int|serial|numeric`,漏掉 `number` → generator
    // 给 NUMBER 列返回 lorem sentence 字符串 → bind Oracle NUMBER 列报
    // ORA-01722 invalid number。
    if (/int|serial|numeric|number/.test(type)) return this.faker.number.int({ min: 1, max: 10000 });
    if (/float|double|decimal|real/.test(type)) {
      return this.faker.number.float({ min: 0, max: 10000, fractionDigits: 2 });
    }
    // v4.0.3.2 Bug #17 fix: DM driver 不接受 JS Date 对象作为 bind 参数,
    // 转 ISO 字符串让 DB driver 自己解析。手测用 '2026-08-18 12:00:00' 字符串 OK,
    // JS Date → DM 报"类型转换异常"(包装成 "表或视图不存在")。
    if (/date|time/.test(type)) {
      return this.faker.date.recent().toISOString().slice(0, 19).replace('T', ' ');
    }
    if (/bool|tinyint\(1\)/.test(type)) return this.faker.datatype.boolean();
    if (/json|jsonb/.test(type)) return JSON.stringify({ sample: true });
    return this.faker.lorem.sentence();
  }
}
