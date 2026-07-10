# 📡 FB/Line → 飞书 消息桥接服务

将 **Facebook Messenger** 和 **Line** 的客户消息实时推送到 **飞书群**。

```
客户在 FB/Line 发消息 → 桥接服务 → 飞书群通知 → 你去原平台回复
```

---

## 🚀 一键部署到 Render（免费）

### 第一步：准备飞书 Webhook

1. 打开你的飞书群 → **设置** → **群机器人**
2. 点击 **添加机器人** → **自定义机器人**
3. 设置机器人名称（如"客服消息桥接"）
4. 复制 **Webhook URL**（格式：`https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx`）
5. 点击完成

### 第二步：部署到 Render

1. 打开 [Render Dashboard](https://dashboard.render.com/)
2. 点击 **New +** → **Web Service**
3. **连接你的仓库**（或将代码推送到 GitHub）  
   或者选择 **Deploy from existing repository**
4. 填写：
   - **Name:** `fb-line-feishu-bridge`
   - **Region:** 选新加坡或日本（离中国近）
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** **Free** ✅

5. 在 **Environment Variables** 添加以下变量：
   ```
   FEISHU_WEBHOOK_URL  = 你复制的飞书Webhook URL
   FB_VERIFY_TOKEN     = 自定义一个复杂字符串，如 fb_webhook_2024_xxx
   LINE_CHANNEL_SECRET = 你的Line Channel Secret
   ```

6. 点击 **Create Web Service**

7. 部署成功后，Render 会给你一个域名，类似：
   ```
   https://fb-line-feishu-bridge.onrender.com
   ```

> ⚠️ **Render 免费版注意：**
> - 15 分钟无访问会自动休眠，有请求时自动唤醒
> - FB/Line 来消息时会触发唤醒，延迟约 5-10 秒
> - 每月 750 小时免费，足够 24h 运行
> - 如果不想休眠，可以设置 `Health Check Path` 为 `/health`（Render Pro）

### 第三步：配置 Facebook Webhook

1. 打开 [Facebook Developer Console](https://developers.facebook.com/)
2. 进入你的应用 → **Products** → **Messenger** → **Settings**
3. 在 **Webhooks** 部分，点击 **Edit Subscription** 或 **Add Callback URL**
4. 填写：
   - **Callback URL:** `https://你的render域名/webhook/facebook`
   - **Verify Token:** 你刚才在环境变量里设置的 `FB_VERIFY_TOKEN`
5. 点击 **Verify and Save**

6. 订阅事件：勾选 **messages**、**messaging_postbacks**

7. 回到 **Messenger Settings** → **Access Tokens**，生成一个 **Page Access Token**
   - 这个 Token 用于获取客户名称（否则飞书显示的是数字ID）
   - 复制这个 Token，回到 Render 后台，添加到环境变量 `FB_PAGE_ACCESS_TOKEN`

### 第四步：配置 Line Webhook

1. 打开 [Line Developer Console](https://developers.line.biz/console/)
2. 进入你的 **Provider** → **Messaging API 频道**
3. 在 **Basic Settings** 页面：
   - 复制 **Channel Secret**
   - 回到 Render 后台，添加到环境变量 `LINE_CHANNEL_SECRET`

4. 在 **Messaging API** 页面：
   - 设置 **Webhook URL:** `https://你的render域名/webhook/line`
   - 点击 **Verify**
   - 打开 **Use webhook** 开关

5. （可选）在 **Messaging API** 页面生成 **Channel Access Token**
   - 回到 Render 后台，添加到环境变量 `LINE_CHANNEL_ACCESS_TOKEN`
   - 不填也能用，只是客户名称显示为数字ID

### 第五步：验证

1. 你的飞书群会收到一条服务启动通知
2. 去 Facebook 粉丝页给你的页面发一条消息
3. 飞书群应该马上收到通知 ✅

---

## 🔧 环境变量说明

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `FEISHU_WEBHOOK_URL` | ✅ | 飞书群机器人的 Webhook URL |
| `FB_VERIFY_TOKEN` | ✅ | Facebook Webhook 验证 Token（自定义） |
| `LINE_CHANNEL_SECRET` | ✅ | Line 频道密钥 |
| `FB_PAGE_ACCESS_TOKEN` | ❌ | 获取 FB 用户名称用（推荐填） |
| `LINE_CHANNEL_ACCESS_TOKEN` | ❌ | 获取 Line 用户名称用 |
| `PORT` | ❌ | 端口号，默认 3000，Render 自动分配 |

---

## 📝 本地开发

```bash
# 1. 安装依赖
cd "C:\Users\Administrator\Desktop\超级大脑\岗位职责\02-客服\fb-line-bridge"
npm install

# 2. 配置环境变量
copy .env.example .env
# 编辑 .env 填写真实值

# 3. 运行
npm start

# 4. 用 ngrok 暴露到公网测试
# ngrok http 3000
```

---

## 📁 文件结构

```
02-客服/
├── fb-line-bridge/
│   ├── server.js          # 主服务
│   ├── package.json       # 依赖配置
│   ├── .env.example       # 环境变量模板
│   └── README.md          # 本文件
└── 工作日志/
    └── 对话记录/           # 自动生成的对话日志
        └── 2026-07-10.md
```

---

## ❓ 常见问题

**Q: Render 免费版够用吗？**
A: 足够。50-200条/天完全没问题。免费版每月 750 小时 = 24×31 小时 = 够用。只是 15 分钟无访问会休眠，但 FB/Line 来消息时会自动唤醒。

**Q: 飞书推送的消息包含什么？**
A: 平台标识（FB/Line）、客户名称、消息内容、时间。如果是图片或其他非文本消息，会标注 `[图片]` 等类型。

**Q: 数据安全吗？**
A: 消息只经过你的 Render 服务实例，没有人能看到。对话日志存在服务本地（Render 重启会丢失），建议定期下载。

**Q: 如何在飞书回复客户？**
A: 目前飞书仅用于 **接收通知**。看到消息后，你打开 FB 或 Line 的原平台回复客户。（如需在飞书直接回复，后续可以升级）
