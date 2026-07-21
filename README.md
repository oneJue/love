# 我们的 · Our Love Book

一个情侣两人共用的网页，核心是**双向沟通簿**：一次事件，双方各写自己视角 → 共同约定 → 各自确认 → 归档和解。配在一起天数计时、时光时间线、给对方的留言。

设计目标：用结构化字段（`agreement` + `maleNote`/`femaleNote` + 双 `confirmation`）从根上消灭"对不起！同意"这种指向不明的歧义——**界面上不出现"同意"二字**，和解靠两人各自点确认按钮。

## 当前版本

Phase 1+：本地优先交互版（零依赖、零后端）。沟通簿、时光、相册和留言均可在页面内直接新增；沟通簿支持提出事件、写/改双方视角、起草约定、双方确认、归档和解、搁置/重新激活/重新打开。结构化数据写在 localStorage，照片原图写在 IndexedDB，单机内切身份模拟两人。

> 真正两人各自从手机在线写入是 Phase 2（SQLite 后端）的事；store 层已抽象好，切换时客户端零重写。

## 沟通簿交互（怎么用）

1. **提出事件**：沟通簿 tab 右下角「+」→ 填标题/日期/严重度/**事实层（事件描述 + 背景图片）**/我的视角 →「记下来」。只有自己一侧视角时状态是「待沟通」。
2. **事实层（任一方可补/改）**：客观"发生了什么"写描述，可附聊天截图等背景（图片存 IndexedDB，背景参考定位，不是对质证据）。条目上「事实层」按钮随时补。
3. **写对方视角**：右上头像切到对方身份 → 条目上「补充我的视角」。（单机模拟，界面上有"当前以 X 身份"明示）
4. **起草约定**：双方视角齐全后，「起草约定」亮起；填共同约定 + 各自想说的话 → 保存，进「待确认」。
5. **双方各自确认**：各自身份下点「我确认」。只点一方显示"你已确认 · 等对方"，两人都点过才进「**已和解**」+ 和解印章 + 已归档。
6. **改约定会自动重置确认**：待确认阶段任一方改约定，双方确认自动撤回，重来。
7. **搁置 / 重新激活 / 重新打开**：任一方可「先放放」（填理由）暂时搁置；随时重新激活；已和解的条目可「重新打开」回到沟通中。永不硬删除。
8. **回忆模式**：沟通簿顶部「沟通/回忆」切换；回忆模式只读，平和回顾。

**界面上绝不出现"同意"二字**——和解靠两人各自点确认按钮，一望可知谁确认了。

## 数据备份

右上头像 → 设置 → 导出备份（下载 JSON，图片附件打包为 base64）/ 导入备份 / 重置为种子。localStorage 数据 + IndexedDB 附件可随时一起导出，换机/换浏览器时导入即可。

## 时光、相册与留言

- **时光**：进入「时光 → 时间线」，点击「记录时光」，填写日期、类型、标题和细节；最新一条会同步到首页。
- **相册**：进入「时光 → 相册」，从设备选择照片并填写日期、说明。原图只保存在本地，导出备份时会与沟通簿附件一起打包。
- **留言**：进入「留言」直接写给对方或写给两个人，可选择心情和置顶。未读状态按当前男方/女方身份分别记录。

## 测试

```bash
node --test test/interaction.test.js    # 38 条：状态机 + DOM id 兼容 + store 权限 + 关系日期 + 时光/留言/相册 + 不变量
node --test test/render-smoke.test.js   # 5 条：渲染层 smoke（种子加载/样例卡/事实层/无"同意"/全流程流转）
node --test test/ui-quality.test.js     # 7 条：首页日期入口 + 沟通上下文/模式联动 + 导航语义 + 弹窗键盘操作
```

## 目录

```
love/
├── index.html              入口（4 tab）
├── data.json               schema v2 数据（改内容只动这个文件）
├── data.legacy.json        旧 schema 备份（只读，迁移留痕）
├── README.md               本文件
├── assets/
│   ├── photos/             照片墙素材
│   └── icons/
├── styles/
│   ├── tokens.css          设计令牌（手账风默认）
│   ├── base.css            通用组件样式
│   └── themes/             4 套主题：scrapbook/minimal/starry/kawaii
└── scripts/
    ├── app.js              入口：tab 路由 / 主题 / 身份 / 首页聚合
    ├── comm-book.js        沟通簿（5 态筛选 + 详情）
    ├── days-together.js    在一起天数
    ├── timeline.js         时光时间线
    ├── photo-wall.js       照片墙
    ├── messages.js         留言
    ├── memory-editor.js    时光 / 留言 / 相册创作表单
    ├── status-machine.js   5 态状态机（唯一真相源）
    ├── date-math.js        日期工具
    ├── schema.js           schema v2 工厂
    └── store.js            数据层（Phase 2 换 fetch /api）
```

## 怎么打开

页面用 `fetch` 读 `data.json`，**不能直接双击** index.html（浏览器安全策略会拦截本地文件 fetch）。

```bash
cd love
python3 -m http.server 8000          # 注意是 -m，缺了会失败
# 浏览器开 http://localhost:8000
```

## 沟通簿记录结构（schema v2）

直接在沟通簿 tab 点「+」记一笔即可，无需手写文件。下面是记录的底层结构，供导出/手动编辑/对接后端时参考：

```json
{
  "id": 2,
  "title": "一句话标题",
  "occurrenceDate": "2026-07-22",
  "createdAt": "2026-07-22T00:00:00.000Z",
  "updatedAt": "2026-07-22T00:00:00.000Z",
  "raisedBy": "男方",
  "severity": "一般",
  "tags": [],
  "description":  { "text": "客观写下发生了什么", "updatedAt": "2026-07-22T00:00:00.000Z", "updatedBy": "男方" },
  "attachments": [],
  "maleView":   { "text": "男方视角的陈述", "updatedAt": "2026-07-22T00:00:00.000Z", "writtenBy": "男方" },
  "femaleView": { "text": "",              "updatedAt": null, "writtenBy": null },
  "agreement":  { "text": "", "updatedAt": null, "updatedBy": null },
  "maleNote":   { "text": "", "updatedAt": null },
  "femaleNote": { "text": "", "updatedAt": null },
  "confirmations": { "male": { "confirmed": false, "at": null }, "female": { "confirmed": false, "at": null } },
  "status": "待沟通",
  "resolutionDate": null,
  "shelvedReason": null, "shelvedFrom": null,
  "gentleReview": false,
  "history": []
}
```

### 字段速查

沟通簿一条记录是**三层结构**：事实层（客观，任一方可写）→ 视角层（主观，各仅本侧）→ 解决层。

| 字段 | 层 | 说明 |
|---|---|---|
| `id` | — | 有序数字 `1, 2, 3…`（删/搁置不回收，只增不减）|
| `occurrenceDate` | — | 事件发生日 |
| `raisedBy` | — | 谁提出（替代旧 `who`）|
| `description` | 事实 | 客观事件描述，任一方可写；不带情绪，两人共同的事实底 |
| `attachments[]` | 事实 | 背景附件（截图为主，背景参考定位）；blob 存 IndexedDB，这里只存元数据 `{id,name,type,size,storeKey,thumb,addedBy,addedAt}` |
| `maleView` / `femaleView` | 视角 | 各自视角，仅本侧写；空 `text` = 还没写 |
| `agreement` | 解决 | 共同约定，中立，任一方可改；空 = 还没拟定；**改它会自动复位双方确认** |
| `maleNote` / `femaleNote` | 解决 | 各自附言（道歉/诉求）|
| `confirmations` | 解决 | 两枚独立确认按钮（`confirmed` + `at`）|
| `status` | 派生 | 5 态，**不要手填** |

### 5 态状态机（自动派生）

```
待沟通 →（双方视角都写完）→ 沟通中 →（起草 agreement）→ 待确认 →（双方点确认）→ 已和解
                                                              （改 agreement 会自动复位确认）
任一开放态 → 已搁置 → 重新激活 → 回到搁置前状态
```

- 两枚确认都点过才进入"已和解"；只点一枚显示"男方已确认 ✓ · 等女方"。
- "待确认"阶段改了 `agreement.text`，两侧 `confirmations` 自动归 false。
- 永不硬删除；已和解可"重新打开"回到沟通中并留痕。

## 设置

右上角头像点头像：切换身份（男方/女方，影响首页"等你的回应"提示与写入归属）、切换主题（手账风/极简/星空/可爱）。

## 首页关系资料

首页点击「填写开始日期」或关系概览右上角编辑按钮，可设置开始日期、双方称呼和关系称呼。保存后首页立即计算在一起天数，无需手动修改 `data.json`。

## 何时切到 Phase 2 后端

当单机切身份模拟两人开始不便、或想要两人各自从手机实时在线写入时，升级 Phase 2：本地 SQLite（`./data/love.db`）+ Flask + 双账号 bcrypt。客户端只需把 `store.js` 的 `localStorageBackend` 换成 `httpBackend`（fetch /api），渲染逻辑零重写。后端会强制：男方改不了女方视角/附言/确认，状态机服务端派生。详见计划文件。
