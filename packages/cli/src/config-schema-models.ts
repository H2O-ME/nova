/**
 * 模型端的两份可编辑清单 schema：`models[]`（设置页「模型」）与 `providers[]`
 * （BYOK 多端点）。
 *
 * 从 `config.ts` 拆出，因为那个文件已经在回答另一个问题——**如何加载与校验整份
 * 配置**（路径解析、`{env:NAME}` 展开、诊断、首跑空壳）。这里只回答「一份模型条目
 * 长什么样」。两件事的读者与失败模式都不同：schema 写错是「配置里的合法写法被拒」，
 * 加载写错是「文件读不出来」。
 *
 * 三处 `models` 形状**逐字相同**（顶层 / 每个供应商内 / 校验语义），所以只有一份
 * 定义：`providers[].models` 与顶层 `models` 用同一个 `modelsSchema`。抄第二份的
 * 那天起，「顶层能写的字段」与「供应商里能写的字段」就开始各自漂移。
 */
import { z } from 'zod';

/**
 * 一条模型目录项。
 *
 * 字段全是**逐字段覆盖**，不是重述：只写 `id` 的条目照样从 models.dev 取窗口与
 * 多模态，所以手改能力是「按需选字段」，而不是「每个模型都要抄一遍」。三个来源的
 * 权威顺序：这里写的 > models.dev > 未知（未知是真答案：仪表不画百分比，而不是猜
 * 一个窗口）。
 */
export const modelEntrySchema = z
  .object({
    /** 请求携带的模型 id（端点自己的拼写优先，见 model-id.ts）。 */
    id: z.string().min(1),
    /** 菜单显示名；缺省取 models.dev，再缺省用 id。 */
    name: z.string().min(1).optional(),
    /** 上下文窗口（prompt tokens）覆盖。 */
    contextWindow: z.number().int().positive().max(200_000_000).optional(),
    /** 单次输出上限（completion tokens）覆盖。 */
    maxOutput: z.number().int().positive().max(10_000_000).optional(),
    /** 输入模态覆盖（text/image/audio/video/pdf）。 */
    inputModalities: z.array(z.string().min(1)).optional(),
    /** 输出模态覆盖。 */
    outputModalities: z.array(z.string().min(1)).optional(),
    /** 是否接受附件覆盖。 */
    attachment: z.boolean().optional(),
    /** 是否输出推理流覆盖。 */
    reasoning: z.boolean().optional(),
    /** 是否支持工具调用覆盖。 */
    toolCall: z.boolean().optional(),
  })
  .strict();

/**
 * 一份模型清单。**非空即接管**：此时列表就是菜单的全部内容——端点没公布的模型也
 * 能加进来（自建/网关私有名字），不想要的删掉即可；缺省时沿用「端点 `GET /models`
 * 公布 + models.dev 元数据」的自动目录。
 */
export const modelsSchema = z.array(modelEntrySchema).optional();

/**
 * 一个供应商（BYOK 多端点）：一个**独立的 OpenAI 兼容端点**，各有自己的
 * baseURL / apiKey / 采样参数 / 上下文窗口覆盖与模型清单。
 */
export const providerEntrySchema = z
  .object({
    /** 稳定标识（改名不改绑定）；`activeProvider` 指的就是它。 */
    id: z.string().min(1),
    /** 显示名（仅用于设置页，「当前在役」由 `activeProvider` 决定）。 */
    name: z.string().min(1).optional(),
    baseURL: z.string().min(1),
    apiKey: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().max(1_000_000).optional(),
    contextWindow: z.number().int().positive().max(200_000_000).optional(),
    /**
     * 这个供应商自己的模型清单。**每个供应商一份**：A 站的 id 在 B 站通常不存在，
     * 共用一份名单会让切换供应商后菜单里全是无效项。语义与顶层 `models` 逐字相同
     * （同一个 `modelsSchema`）。
     */
    models: modelsSchema,
  })
  .strict();

/** 供应商清单（BYOK 多端点）。空数组在写盘侧会被删键（空即不存在）。 */
export const providersSchema = z.array(providerEntrySchema).optional();
