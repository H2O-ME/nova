/**
 * The shell's own words.
 *
 * A typed dictionary for the chrome that belongs to the page rather than to a
 * feature — the crash notice, the session header's fixed controls, and the
 * connection readout. They cannot borrow a feature's dictionary: the header
 * seats are shell chrome (the session sidebar they used to live in is gone),
 * and the crash notice must be readable when everything else has failed.
 */
export const SHELL_COPY = {
  /** The header's new-session verb. */
  'session.new': '新会话',
  'session.new.label': '新建会话',
  /** The header's settings seat. */
  'settings.label': '设置',
  /** The connection readout's words (the reference dictionary's `sidebar`
   *  connection namespace, verbatim). */
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '自动重连中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在自动重试，点击立即重连',
  /** The crash notice's headline. */
  'error.title': '界面出错了',
  /** What failed and why; `{label}` is the part that broke. */
  'error.note': '{label}渲染时出错：{message}',
  /** The way out: a full reload, since a crashed tree cannot be revived in place. */
  'error.reload': '重新加载页面',
  /** The whole app (the entry's boundary). */
  'error.label.app': '界面',
  /** The right column, when only it failed. */
  'error.label.rightbar': '侧边栏',
} as const;
