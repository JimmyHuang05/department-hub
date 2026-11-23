---
name: ibd-link-plus
description: 使用 GCO Link API 查询并在用户二次确认后修改项目、周报、云盘、工具、技能和问卷。
---

# GCO Link Agent

版本：`20260821-180000`

使用提供此说明的同一站点作为 API 域名。

读取路径：`/api/integration/v1`

写入路径：`/api/agent/v1`

所有请求使用用户当前的同一把 API Key：

```http
X-API-Key: <用户提供的 API Key>
X-IBD-Skill-Version: 20260821-180000
```

不得在回复、日志、截图或公开内容中显示 API Key。

## 强制写入流程

任何修改都必须遵循以下顺序，不得跳步：

1. 使用只读接口读取目标及当前 `revision`。
2. 调用 `POST /changes/prepare`，只生成冻结的修改差异，不写入业务数据。
3. 读取响应中的 `confirmation`。
4. 使用 Agent 宿主提供的原生选项弹窗向用户展示全部修改内容。
5. 弹窗必须提供“确认修改”“返回修改”“取消”三个选项。
6. 只有用户明确选择“确认修改”后，才调用 `POST /changes/commit`。
7. 用户选择“返回修改”时，废弃旧变更并重新执行 prepare。
8. 用户选择“取消”时调用 `POST /changes/cancel`，或者不再执行任何写请求。

禁止用聊天中的模糊表达代替二次确认。禁止自动选择“确认修改”。禁止在 prepare 后修改 Payload。禁止直接调用 IBD 网页端内部写接口。

若 Agent 宿主没有原生选择弹窗，必须暂停并用清晰的结构化列表展示差异，等待用户明确回复“确认修改”；不能自行继续。

## 读取

首次连接调用：

```http
GET /bootstrap
```

常用接口：

```http
GET /projects
GET /projects/{id}
GET /worklogs
GET /worklogs/{id}
GET /files
GET /tools
GET /skills
```

### 列表分页与完整性

`/projects`、`/worklogs` 和 `/questionnaires` 使用游标分页。默认每页 50 条，单页最多 100 条。

```http
GET /worklogs?limit=50
GET /worklogs?limit=50&cursor=<上一页 page.nextCursor>
```

响应中的 `page` 包含 `total`、`returned`、`limit`、`hasMore` 和 `nextCursor`。

- 只要 `page.hasMore` 为 `true`，就必须携带 `page.nextCursor` 继续读取。
- 只有读取到 `hasMore=false` 后，才可以声称已检查全部授权记录。
- 不得仅根据第一页结果判断项目或周报不存在。
- 查找单个目标时，优先使用 `q` 或 `keyword` 搜索；搜索无结果且需要作出“不存在”结论时，必须完成全量分页。
- 不支持 `offset`；接口返回 `INVALID_CURSOR` 或 `STALE_CURSOR` 时，从第一页重新读取。

### 稳定标识检索

项目和周报响应的 `data.identifiers` 提供 `projectId`、`projectCode`、`contractNo`、`aliases` 和 `channel`。查找顺序必须是：合同号、项目代码、关联项目 ID、标准名称、别名，最后才使用模糊匹配。

```http
GET /projects?projectCode=HB2653
GET /worklogs?projectCode=HB2653
GET /worklogs?contractNo=1202303299_9999(Z)
```

## 云端优先使用

默认不得为了读取或使用内容而下载完整文件到用户电脑。优先使用以下在线能力：

```http
GET /files/{id}/content?start=0&maxChars=50000
GET /files/{id}/content?ocr=true&start=0&maxChars=50000
GET /files/search-content?q=关键词&limit=10
GET /tools/{id}
GET /skills/{id}/manifest
GET /skills/{id}/content
GET /skills/{id}/file?path=references/example.md
```

- 云盘文本及 DOCX、PPTX、XLSX、XLS 文件使用 `/content` 分段读取；Office 内容由服务器提取并缓存，仅在用户明确要求离线文件时使用 `/download`。
- 不知道具体文件时，先用 `/files/search-content` 在云端检索正文，根据命中片段选择文件；不得为搜索而批量下载文件。
- 普通 PDF 会自动按页提取并返回页码；只有普通提取没有正文时，才可显式使用 `ocr=true` 识别扫描 PDF 或图片。
- OCR 在 IBD 服务器本地运行，最多处理前 10 页；同一 Key 每 30 秒最多发起一次，不得并发轮询 OCR。
- 工具使用详情返回的 `runUrl` 在线打开，不下载 HTML。
- Skill 先读取 `manifest` 并记住响应中的版本 ID，再携带 `versionId` 读取入口 `SKILL.md` 或引用文件，防止任务过程中版本更新导致内容漂移。
- 远程 Skill 文件只在当前任务中使用，不得擅自保存为永久本地副本。
- 二进制 Skill 资源以 Base64 返回；单个远程文件不能超过 2MB。

写入前先调用：

```http
GET /api/agent/v1/capabilities
```

只能使用 capabilities 返回的资源、动作和字段。

## 准备修改

```http
POST /api/agent/v1/changes/prepare
Content-Type: application/json
```

```json
{
  "protocol": "ibd-agent-change/1.0",
  "requestId": "每次操作唯一的 UUID",
  "resource": "project",
  "action": "update",
  "target": {
    "id": "目标 ID",
    "revision": "读取接口返回的 revision"
  },
  "payload": {
    "changes": {
      "status": "上会中"
    }
  },
  "reason": "根据用户要求更新项目状态"
}
```

prepare 成功后必须把 `confirmation.items` 中每一项的修改前、修改后内容展示给用户。

## 用户确认后提交

```http
POST /api/agent/v1/changes/commit
Content-Type: application/json
```

```json
{
  "changeId": "prepare 返回的 changeId",
  "confirmationToken": "prepare 返回的 confirmationToken",
  "decision": "confirm",
  "confirmation": {
    "channel": "codex-or-workbuddy",
    "confirmedAt": "ISO 时间"
  }
}
```

确认凭证只能使用一次，十五分钟后过期。若返回 `409`，说明确认期间数据已变化；必须重新读取、prepare 并再次让用户确认。

## 取消

```http
POST /api/agent/v1/changes/cancel
```

```json
{
  "changeId": "待确认变更 ID"
}
```

## 文件操作

云盘上传、工具发布和技能发布先暂存文件：

```http
POST /api/agent/v1/uploads
Content-Type: multipart/form-data
```

表单字段名必须为 `file`。响应中的 `uploadRef` 用于 prepare。暂存文件在正式确认前不会进入云盘、工具或技能目录。

## 支持的资源

- `project.update`
- `worklog.update`
- `clouddrive.upload`
- `clouddrive.create_folder`
- `clouddrive.trash`，只移入回收站，不永久删除
- `tool.create`
- `tool.publish_version`
- `tool.update_metadata`
- `skill.create`
- `skill.publish_version`
- `skill.update_metadata`
- `questionnaire.create`，默认创建为草稿
- `questionnaire.update`

项目和周报不可通过 Agent 删除；云盘不可永久删除；工具、技能和问卷不可通过 Agent 永久删除。
