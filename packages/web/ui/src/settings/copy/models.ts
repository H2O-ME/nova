/**
 * 模型版块的文案：页面头、供应商（BYOK 多端点）、端点模型目录与模型参数。
 *
 * 词汇对齐 deepseek-harness `ui-settings-models`（`src/client/locales.ts` 的 zh 表，
 * MIT，(c) 2026 DeepSeek）：标题/说明（`title` / `intro`）、行内动作（`edit` /
 * `remove` / `add`）、密钥状态（`credentialConfigured` / `credentialMissing` /
 * `keyStored`）、模型字段（`contextWindow` / `maxTokens` / `modelId` / `modelName` /
 * `modelNamePlaceholder` / `modelInputTypes`）、容量词法（`modelCapacityInvalid`）、
 * 探测（`fetchModels` / `fetching` / `fetchEmpty`）与继承态（`modelsInherited`）。
 * 本仓自己写的部分（多供应商行、请求参数、当前生效/自动值）在这份表里就地说明。
 */
export const MODELS_COPY = {
  'models.nav': '模型',
  'models.title': '模型',
  // The reference's own intro sentence, verbatim in intent: it names the one
  // action that makes models usable (filling in a key), not the mechanism.
  'models.intro': '填入各提供商的 API 密钥即可使用其模型。',
  /* ── 供应商（多端点） ───────────────────────────────────────── */
  'models.providerTitle': '供应商',
  'models.providerIntro': '会话使用的 OpenAI 兼容端点。标着「当前使用」的那一个在役。',
  'models.providerLoading': '正在读取供应商列表…',
  'models.providerEmpty': '还没有配置供应商。填写 API 地址与密钥后即可使用。',
  'models.providerAdd': '添加模型提供商',
  'models.providerName': '显示名称',
  'models.providerNamePlaceholder': '例如 官方 / 中转站',
  'models.providerBaseUrl': 'API 地址',
  'models.providerBaseUrlPlaceholder': 'https://api.example.com/v1',
  'models.providerNoUrl': '未填写 API 地址',
  'models.providerApiKey': 'API 密钥',
  'models.providerApiKeyPlaceholder': 'sk-… 或 {env:NAME}',
  // The reference's `keyStored`: the field starts empty even when a key exists,
  // and an empty field must mean "keep it".
  'models.providerApiKeySet': '已配置——输入新值可替换',
  'models.providerApiKeyHint': '密钥只存在本机配置文件中，永不回显到浏览器；支持 {env:NAME} 引用。',
  // 只有「缺」这一态有词：它是「设为当前」按不动的那个原因。配好了不印字。
  'models.providerKeyMissing': 'API 密钥缺失',
  'models.providerActive': '当前使用',
  'models.providerUse': '设为当前',
  'models.providerEdit': '编辑',
  'models.providerCollapse': '收起',
  'models.providerRemove': '删除',
  // 「N 个模型」on a collapsed row (requirement: a provider's model count is
  // readable without opening it).
  'models.providerModelCount': '个模型',
  'models.providerModelCountZero': '没有记录模型',
  /* 请求参数：端点的采样参数，随端点保存（不是模型能力） */
  'models.providerParams': '请求参数',
  'models.providerParamsHint': '留空即用端点默认值；只作用于这个端点。容量可写 128K / 1M。',
  'models.providerCapacityPlaceholder': '留空即端点默认值，如 128K',
  'models.temperature': '采样温度 temperature',
  'models.temperatureHint': '0 到 2 之间的数字',
  'models.maxTokens': '输出上限 maxTokens',
  'models.contextWindow': '上下文窗口 contextWindow',
  /* 该端点的模型清单（providers[].models） */
  'models.providerModels': '模型清单',
  'models.providerModelsHint': '记录在这个供应商名下的模型 ID。真正决定会话菜单的是「模型参数」那一份清单。',
  'models.providerModelsEmpty': '还没有记录模型。可先获取目录，再逐个添加。',
  'models.providerAddModelPlaceholder': '手动输入模型 ID',
  'models.providerAddModel': '添加',
  'models.providerModelsRemove': '移除',
  'models.providerProbe': '获取可用模型',
  'models.providerProbing': '正在询问提供商…',
  'models.providerProbeNeedsUrl': '请先填写 API 地址，再获取。',
  'models.providerProbeFail': '获取失败',
  'models.providerNoReachable': '该提供商没有列出任何模型，请手动添加。',
  'models.providerSave': '保存',
  'models.providerCancel': '取消',
  // A card's own footer refuses to commit when a field is unreadable; the
  // sentence lands on the card, not in a page-level alert.
  'models.providerSaveFirst': '请先保存供应商，再切换。',
  'models.providerRemoveNow': '删除立刻生效（重新添加即可恢复）。',
  'models.providerSwitchNote': '「设为当前」立刻把本进程指向该端点。',
  /* ── 取模弹窗（「获取可用模型」） ─────────────────────────────── */
  // 标题说的是**这件事**：把端点公布的模型挑几个加进这张卡。切换会话在用的
  // 模型是 composer 那个座位的事，设置页不管——参考实现里也是如此。
  'models.pickTitle': '选择要添加的模型',
  'models.pickSearch': '搜索模型…',
  'models.pickAll': '全选',
  'models.pickNone': '清空',
  'models.pickExisting': '已在清单',
  'models.pickNoMatch': '没有匹配的模型。',
  'models.pickApply': '添加所选',
  'models.pickCancel': '取消',
  /* ── 会话标题模型（config `titleModel`） ────────────────────── */
  // 摆在「模型参数」折叠块之前：它是主路设置（要不要标题），不是逐字段进阶。
  'models.titleRow': '会话标题模型',
  'models.titleHint': '每段会话的第一条消息由这个模型生成一个短标题；留空则不生成。',
  'models.titleNone': '不生成标题',

  /* ── 模型参数（config `models[]`） ────────────────────────── */
  'models.configTitle': '模型参数',
  'models.configIntro': '逐字段覆盖模型能力：留空即自动取自 models.dev，填写即覆盖并写入配置文件。',
  'models.configInherited': '未自定义：会话菜单直接使用端点公布的模型目录。',
  'models.configTakeover': '这份清单非空时即为会话菜单的全部内容：端点没公布的模型也能用，删掉的不再出现。',
  'models.configId': '模型 ID',
  'models.configName': '显示名称',
  'models.configNamePlaceholder': '留空时使用模型 ID',
  'models.configRemove': '删除模型',
  // The reference's `modelAdvanced`: the disclosure that hides the capability
  // fields until they are asked for.
  'models.configAdvanced': '模型选项',
  'models.configEffectiveLabel': '当前生效',
  'models.configEffectiveAuto': '自动',
  'models.configEffectiveManual': '手动',
  'models.configAutoLabel': '自动值',
  'models.configAdd': '添加模型',
  'models.configAddPlaceholder': '从端点公布的模型中选择，或手动输入模型 ID',
  'models.configPublished': '端点公布的模型',
  'models.configPublishedEmpty': '端点没有公布模型，请手动输入 ID。',
  'models.configSave': '保存',
  'models.configReadOnly': '当前服务没有可写的配置文件，只能查看。',
  // The reference's `modelCapacityInvalid`, extended with the range clause: the
  // config's own schema bounds these numbers, and a value past the bound would
  // make the file unloadable rather than merely wrong.
  'models.configInvalidCapacity': '容量需为数字，可加 K 或 M 后缀。',
  'models.configInvalidTemperature': '采样温度需为 0 到 2 之间的数字。',
  'models.configRangeExceeded': '数值超出允许范围。',
  'models.configEmptyId': '模型 ID 不能为空。',
  'models.configDuplicateId': '模型 ID 不能重复。',
  /* 模型能力字段（`ConfiguredModel` 一条目） */
  'models.fieldContextWindow': '上下文窗口',
  'models.fieldMaxOutput': '最大输出 token 数',
  'models.fieldInputModalities': '输入类型',
  'models.fieldOutputModalities': '输出类型',
  'models.fieldAttachment': '接受附件',
  'models.fieldReasoning': '推理输出',
  'models.fieldToolCall': '工具调用',
  // The five modalities the request path accepts (`core/image-projection.ts`).
  'models.modalityText': '文本',
  'models.modalityImage': '图片',
  'models.modalityAudio': '音频',
  'models.modalityVideo': '视频',
  'models.modalityPdf': 'PDF',
  /* 三态开关的两个明确取值；「自动」由占位/读数承担，所以没有第三个词 */
  'models.stateOn': '开',
  'models.stateOff': '关',
} as const;
