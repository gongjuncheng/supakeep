# SupaKeep

> 自托管的 Supabase 免费项目保活面板 —— 防止开发期项目因长期无访问被暂停。

SupaKeep 是一个轻量、自托管的 Node.js 服务，提供一个 Web 面板，让你把 Supabase 项目加进去，按设定频率自动「保活」，并把每次结果写入**你自己 Supabase 项目里的日志表**，可随时审计。

- 🔐 账号登录 + JWT
- 📋 多项目管理，支持编辑
- ⏱️ 保活间隔支持小数（小时），如 `0.01`
- 📝 每次保活向你的 Supabase 写一条日志（自证清白）
- 📟 内置实时控制台（SSE），与后端日志同步
- 🧹 一键清空保活日志
- 🔒 全站 HTTPS，证书三文件独立配置、不合并

---

## 工作原理

Supabase 免费项目长期无访问会被自动暂停。SupaKeep 定期向你的项目发起合法 API 请求，模拟「有人在用」：

1. 用你的 **anon key** 请求 Supabase（全程走你自己的密钥）
2. 查询 `keepalive` 表，让 Supabase 认为项目有活动
3. 向 `keepalive_logs` 表 INSERT 一条记录（状态码、延迟、时间）—— 持续写入更像真实业务
4. 日志同时推送到 Web 控制台 `/console`

> 日志存在你自己的 Supabase 里，任何人（包括面板运营方）都无法篡改，是「真的在保活」的铁证。

---

## 快速开始

### 1. 准备证书

把三份证书放进 `ssl/` 目录（**不要提交到 Git**）：

```
ssl/private.key      # 私钥
ssl/certificate.crt  # 主证书
ssl/ca_bundle.crt    # CA 中间证书包
```

详见 [`ssl/README.md`](ssl/README.md)。

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少把 JWT_SECRET 改成一个随机长字符串
```

### 3. 安装并启动

```bash
npm install
npm start
```

服务启动后：

| 用途 | 地址 |
|------|------|
| 面板 | `https://你的域名:6592` |
| 实时控制台 | `https://你的域名:6592/console` |

### 4. 在 Supabase 建表

打开你的 Supabase 项目 → **SQL Editor**，执行 [`setup.sql`](setup.sql) 里的全部内容。

该 SQL 仅包含 `CREATE TABLE / ALTER / CREATE POLICY / INSERT`，无任何删除或修改数据的操作，可重复执行。

### 5. 添加项目

登录面板 → 填写项目名、Supabase URL、anon key、保活间隔 → 添加。

---

## 接口说明

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/register` | 注册 |
| POST | `/login` | 登录，返回 token |
| GET | `/projects` | 获取项目列表 |
| POST | `/projects` | 添加项目 |
| PUT | `/projects/:id` | 编辑项目 |
| DELETE | `/projects/:id` | 删除项目 |
| DELETE | `/projects/:id/logs` | 清空该项目保活日志 |
| POST | `/ping/:id` | 手动保活 |
| POST | `/change-password` | 修改密码 |
| DELETE | `/account` | 注销账号 |
| GET | `/health` | 健康检查 |
| GET | `/console` | 实时日志流（SSE） |

---

## 目录结构

```
supakeep/
├── index.js          # 主服务（Express + HTTPS + 业务逻辑）
├── index.html        # Web 面板
├── package.json
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── setup.sql         # Supabase 建表脚本
└── ssl/
    └── README.md     # 证书存放说明
```

---

## 使用须知

- 本项目用于**开发/演示期防止项目冷启动**，请合理使用，不要高频骚扰 Supabase
- 只使用 **anon key**，切勿填入 service_role key
- 保活日志会持续增长，建议定期点击「🗑️ 清日志」清理
- 本项目按现状提供，作者不对任何账号限制或封禁风险负责

---

## License

[MIT](LICENSE)
