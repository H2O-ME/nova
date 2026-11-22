/**
 * The A2UI renderer: the official `@a2ui/react` surface over one
 * `MessageProcessor` per tool card.
 *
 * 自研渲染器换成官方 BASIC catalog（lit 自定义元素 + `--a2ui-*` 主题桥，见
 * `A2uiView.module.css`）。核心不变量与旧实现一致：卡片的消息列表在挂载时
 * 一次性喂给 processor（settled 结果的消息数组不再增长），输入的双向绑定与
 * 动作时的上下文求值都归官方 processor，动作经 `useA2uiSubmit` 作为下一条
 * 用户消息回传。
 *
 * ZCode 对照（参照纪律）：`zcode-desktop-ui-study/packages/ui/src/gen-ui` 是
 * 「宿主页面 + anchor 绑定」的页面式生成 UI，没有 A2UI 集成对应物——采用官方
 * `@a2ui/react` README 的 processor→surface 订阅模式，放弃其 page/host 生命
 * 周期模型；`@a2ui/react/styles` 的 `injectStyles()` 只服务 v0.8 light-DOM 渲
 * 染器，v1.0 BASIC 是 lit shadow-DOM 自带样式，不引入。
 *
 * 边界归一（产品固定 BASIC catalog + v1.0）：core 解析器把缺省 version 重写为
 * `'v0.9'`（core/a2ui.ts），而官方 v1.0 adapter 只认 `'1.0'`；v1.0 规则下
 * `createSurface` 缺 `catalogId` 的 surface 没有默认 catalog，组件解析会整体
 * 失败（web_core `message-processor.js` 的 `noDefaultCatalog` 分支）。喂入前
 * 统一补齐这两处，消息形状本身不动。
 *
 * 两道门的分工（实测，2026-11-22）：core 的 `parseA2uiMessages` 是组件白名单
 * 那道门——它的 18 个名字与官方 BASIC catalog 逐项一致，未知组件在到达渲染层
 * 之前就被拒。官方 processor 那道的范围不同：它**会**拒绝非法的 prop 取值
 * （`variant: 'h1'` → A2uiValidationError）和缺 catalogId 的 surface，但**不**
 * 拒绝未知组件名——那种 payload 建得出 surface，直到 `A2uiSurface` 解析节点时
 * 才 throw（`A2UI catalog entry 'X' has no element`）。因此这里的 catch 是兜底
 * 而不是主力：正常路径上坏消息进不了这个组件。 */
import { useEffect, useRef, useState } from 'react';
import type { A2uiMessage } from '@nova-agent/core';
import {
  MessageProcessor,
  basicCatalog,
  injectBasicCatalogStyles,
  type ActionPayload,
} from '@a2ui/web_core/v1_0';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { A2uiSurface, MarkdownContext, type ReactCatalogComponent } from '@a2ui/react';
import { renderMarkdown } from '@a2ui/markdown-it';
import { useA2uiSubmit, type A2uiSubmission } from './action-context.js';
import { useTheme } from '../theme.js';
import css from './A2uiView.module.css';

/** One surface to draw: the official state model, React-flavored. */
type Surface = SurfaceModel<ReactCatalogComponent>;

export interface A2uiViewProps {
  messages: readonly A2uiMessage[];
}

/**
 * Either the ready processor or the reason the card renders nothing. The
 * constructor wiring (action handler) needs the processor before it exists, so
 * the result is built as one step.
 */
type ProcessorResult =
  | { readonly processor: MessageProcessor; readonly error: undefined }
  | { readonly processor: undefined; readonly error: unknown };

/** The submit function or null, read through a ref at action time. */
type SubmitSlot = { current: ((submission: A2uiSubmission) => void) | null };

/** The design-token stylesheet is document-global; one injection serves all cards. */
let stylesInjected = false;

export function A2uiView({ messages }: A2uiViewProps): JSX.Element | null {
  // 客户端专属：静态导出预渲染时没有 document，注入留在 effect 里。
  useEffect(() => {
    if (!stylesInjected) {
      stylesInjected = true;
      injectBasicCatalogStyles();
    }
  }, []);

  // The submit bridge lives in a ref so the action handler (created once, in
  // the processor) always reaches the current provider without re-creating the
  // processor when the provider's callback identity changes.
  const submit = useA2uiSubmit();
  const submitRef = useRef<SubmitSlot['current']>(submit);
  submitRef.current = submit;

  const [result] = useState<ProcessorResult>(() => createProcessor(messages, submitRef));
  const { dark } = useTheme();

  const [surfaces, setSurfaces] = useState<readonly Surface[]>(() => surfacesOf(result));
  useEffect(() => {
    if (result.processor === undefined) return undefined;
    const sync = (): void => { setSurfaces(surfacesOf(result)); };
    const created = result.processor.onSurfaceCreated(sync);
    const deleted = result.processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [result]);
  // The processor owns surface state; dying with the card is its teardown.
  useEffect(() => {
    const { processor } = result;
    if (processor === undefined) return undefined;
    return () => { processor.dispose(); };
  }, [result]);

  if (result.processor === undefined) {
    // A silent `null` here is how a real failure hides: the transcript showed an
    // expanded tool row with NOTHING inside it, and the only trace was a console
    // line nobody reads. The card now states that the surface was refused and
    // why — the same reason the console keeps, so a report can quote it.
    return (
      <p className={css.rejected} role="status">
        界面未渲染：官方 A2UI 校验拒绝这批消息（{reasonOf(result.error)}）。
      </p>
    );
  }
  if (surfaces.length === 0) return null;
  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className={`${css.root} ${dark ? 'a2ui-dark' : 'a2ui-light'}`}>
        {surfaces.map((surface) => <A2uiSurface key={surface.id} surface={surface} />)}
      </div>
    </MarkdownContext.Provider>
  );
}

/** One readable line from a thrown validation error. */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Zod's message is the useful half; the "Validation failed for component…"
  // prefix is kept so the component id stays visible in the report.
  return text.replace(/\s+/gu, ' ').trim().slice(0, 300) || '原因未知';
}

function surfacesOf(result: ProcessorResult): readonly Surface[] {
  if (result.processor === undefined) return [];
  // 同一个类，两种泛型实参：web_core 的 SurfaceModel<T> 因 Catalog<T> 占位而
  // 对 T 不变，React 的 A2uiSurface 要的是 ReactCatalogComponent 联合；运行时
  // 值来自同一个 SurfaceModel 类，条目（WebComponentImplementation）本就是该
  // 联合的成员，边界处转换一次。
  return Array.from(result.processor.getSurfaces().values()) as unknown as readonly Surface[];
}

function createProcessor(messages: readonly A2uiMessage[], submitRef: SubmitSlot): ProcessorResult {
  let processor: MessageProcessor | undefined;
  try {
    const handler = (action: ActionPayload): void => {
      if (processor === undefined) return;
      const send = submitRef.current;
      if (send === null) return;
      const surface = processor.getSurface(action.surfaceId);
      send({
        name: action.name,
        context: action.context,
        surfaceId: action.surfaceId,
        sourceComponentId: action.sourceComponentId,
        timestamp: action.timestamp,
        // `sendDataModel` surfaces report their whole model with every action;
        // `getRendererDataModel()` is the official renderer→agent envelope.
        ...(surface?.sendDataModel === true ? { dataModel: processor.getRendererDataModel() } : {}),
      });
    };
    processor = new MessageProcessor([basicCatalog], handler, { version: 'v1_0' });
    processor.processMessages(processorPayloadOf(messages));
    return { processor, error: undefined };
  } catch (error) {
    // Backstop, not the main gate: core already refused unknown components
    // (its 18 names equal the catalog's), so what reaches this catch is an
    // illegal PROP value or a surface the official schemas reject. The card
    // draws nothing and the console carries the reason — logged once, here.
    console.error('a2ui: 官方 processor 拒绝了这批消息，卡片不渲染。', error);
    processor?.dispose();
    return { processor: undefined, error };
  }
}

/**
 * The card's messages as the v1.0 processor expects them: every message tagged
 * `'1.0'`, every surface pinned to the product's BASIC catalog when the model
 * left the catalog unnamed. Shapes pass through untouched.
 */
function processorPayloadOf(messages: readonly A2uiMessage[]): readonly Record<string, unknown>[] {
  return messages.map((message) => {
    if ('createSurface' in message) {
      return {
        version: '1.0',
        createSurface: {
          ...message.createSurface,
          catalogId: message.createSurface.catalogId ?? basicCatalog.id,
        },
      };
    }
    return { ...message, version: '1.0' };
  });
}
