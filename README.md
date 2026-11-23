# Department Hub

可自托管的通用部门管理后台。适合需要在同一个工作台管理项目、管理周报、团队任务和内部资料的部门。界面以中文为主，安装后可以从空库运行，也可以生成一套虚构业务数据。

## 功能

- **项目与协作**　项目台账、状态与负责人、管理周报、历史快照、任务、通知和讨论。
- **资料与工具**　部门云盘、在线表格、内部工具与技能，支持上传、预览和版本记录。
- **问卷**　公开填写链接、条件题、附件、答卷处理、统计与导出。
- **管理**　角色权限、审计日志、定时任务、备份与恢复。

前端使用 React、TypeScript 和 Vite。后端使用 Express、SQLite（sql.js）和 WebSocket。生产构建由后端在同一端口提供页面与 API。

## 本地运行

需要 Node.js 22 或更高版本及 npm。

```sh
npm ci
npm run build
npm start
```

打开 http://127.0.0.1:3000。首次启动会在 `data/initial-admin-password.txt` 生成管理员 `IBD-00001` 的初始密码。生产部署请持久化 `data/`，并在反向代理上启用 HTTPS。默认界面提供简体中文。

## 试用虚构数据

```sh
npm run demo:seed -- demo-data
```

生成器会创建近五年的部门协作数据，包括多成员任务和回复、消息收发及投票、操作日志、云盘文件、技能包、问卷附件与历史周报。目标目录必须是新目录。下面的命令启动只监听本机的实例。

```sh
IBD_DATA_DIR=./demo-data IBD_HOST=127.0.0.1 npm start
```

PowerShell：

```powershell
$env:IBD_DATA_DIR = Join-Path (Get-Location) 'demo-data'
$env:IBD_HOST = '127.0.0.1'
npm.cmd start
```

使用 `demo-data/initial-admin-password.txt` 中的密码登录。站内的「联衡信托」和「全球资本运营部」是虚构的界面示例，相关名称与素材可从 `src/`、`index.html` 和 `public/` 修改。启用生产部署前，请使用空的持久化数据目录。

## 开发与部署

开发时分别运行 `npm run dev:server` 与 `npm run dev`，或者运行 `node scripts/dev-all.cjs`。检查代码可运行 `npm run check`、`npm test` 和 `npm run build`。

使用 Docker Compose 时，在项目根目录运行 `docker compose up --build`。服务默认使用 3000 端口，持久化数据保存到命名卷。示例环境变量见 [`.env.example`](.env.example)。Node 直接启动时从进程读取环境变量；Compose 会读取仓库根目录的本地 `.env`。

集成 API 的说明在运行站点的 `/skill.md`。如通过反向代理对外提供服务，可用 `IBD_PUBLIC_URL` 指定公开站点地址。

应用页的 CRM 入口是可选集成。若已有独立 CRM，在构建前将 `VITE_CRM_URL` 设置为它的 HTTP(S) 地址。
