// ============================================================
// FB/Line → 飞书 消息桥接服务
// 功能：接收 Facebook Messenger 和 Line 的 Webhook 消息，
//       推送到飞书群，同时存档到本地日志
// 部署：Render / Railway / 任何 Node.js 环境
// ============================================================

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const START_TIME = Date.now();

// ─── 日志目录（Render 上日志写入 /tmp，不持久化） ───
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', '工作日志', '对话记录');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

// ─── 工具：记录对话到本地文件 ───
function logConversation(platform, userId, userName, message, direction = 'received') {
  const date = new Date().toISOString().split('T')[0];
  const logFile = path.join(LOG_DIR, `${date}.md`);
  const time = new Date().toLocaleString('zh-CN', { hour12: false });
  const line = `| ${time} | ${platform} | ${userName} (${userId}) | ${direction} | ${message.replace(/\n/g, ' ')} |\n`;

  try {
    // 如果文件不存在，写入表头
    if (!fs.existsSync(logFile)) {
      const header = `# 客服对话记录 - ${date}\n\n| 时间 | 平台 | 用户 | 方向 | 内容 |\n|------|------|------|------|------|\n`;
      fs.writeFileSync(logFile, header + line, 'utf-8');
    } else {
      fs.appendFileSync(logFile, line, 'utf-8');
    }
  } catch (e) {
    console.error(`[日志] 写入失败: ${e.message}`);
  }
}

// ─── 飞书通知 ────────────────────────────────────────────
async function sendToFeishu(messagePayload) {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[飞书] ⚠️ FEISHU_WEBHOOK_URL 未配置，跳过通知');
    return false;
  }

  try {
    const resp = await axios.post(webhookUrl, messagePayload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[飞书] ✅ 通知发送成功 (${resp.data?.code || resp.status})`);
    return true;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[飞书] ❌ 发送失败: ${detail}`);
    return false;
  }
}

function buildFeishuCard(platform, customerName, customerId, text, timestamp, platformIcon) {
  const cardColor = platform === 'Facebook' ? 'blue' : 'green';
  const platformLabel = platform === 'Facebook' ? 'FB' : 'Line';

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `💬 ${platform} 客户新消息` },
        color: cardColor
      },
      elements: [
        {
          tag: 'markdown',
          content: [
            `**平台：** ${platform}`,
            `**客户：** ${customerName}`,
            customerId ? `**ID：** \`${customerId}\`` : null,
            `**时间：** ${timestamp}`,
            '',
            `**消息内容：**`,
            `> ${text || '[非文本消息/图片]'}`,
            '',
            `---`,
            `📌 请到 **${platform}** 原平台回复该客户`
          ].filter(Boolean).join('\n')
        }
      ]
    }
  };
}

// ─── 获取 FB 用户名称 ────────────────────────────────────
const fbNameCache = new Map();

async function getFacebookUserName(userId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return `用户 ${userId.slice(0, 8)}`;

  if (fbNameCache.has(userId)) return fbNameCache.get(userId);

  try {
    const resp = await axios.get(`https://graph.facebook.com/v20.0/${userId}`, {
      params: { fields: 'name', access_token: token },
      timeout: 5000
    });
    const name = resp.data?.name || `用户 ${userId.slice(0, 8)}`;
    fbNameCache.set(userId, name);
    return name;
  } catch {
    return `用户 ${userId.slice(0, 8)}`;
  }
}

// ─── 获取 Line 用户名称（需要 Line 的 API） ─────────────
async function getLineUserName(userId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return `用户 ${userId.slice(0, 8)}`;

  try {
    const resp = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000
    });
    return resp.data?.displayName || `用户 ${userId.slice(0, 8)}`;
  } catch {
    return `用户 ${userId.slice(0, 8)}`;
  }
}

// ============================================================
// 路由
// ============================================================

// ─── 首页 / 健康检查 ────────────────────────────────────
app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({
    service: 'FB/Line → 飞书 消息桥接',
    status: 'running',
    uptime: `${uptime}s`,
    time: new Date().toISOString(),
    endpoints: {
      facebook_webhook: '/webhook/facebook',
      line_webhook: '/webhook/line',
      health: '/health'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Date.now() - START_TIME });
});

// ─── Facebook Messenger Webhook ───────────────────────────
// GET：用于 Facebook 平台的 Webhook 验证
app.get('/webhook/facebook', (req, res) => {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[FB] ✅ Webhook 验证通过');
    return res.status(200).send(challenge);
  }

  console.log(`[FB] ❌ Webhook 验证失败 (mode=${mode}, token匹配=${token === VERIFY_TOKEN})`);
  res.sendStatus(403);
});

// POST：接收 Facebook 消息
app.post('/webhook/facebook', express.json(), async (req, res) => {
  // 立即返回 200，避免 FB 认为超时重发
  res.sendStatus(200);

  try {
    const { entry, object } = req.body;
    if (object !== 'page' || !entry) return;

    for (const e of entry) {
      const messagingList = e.messaging || [];
      for (const event of messagingList) {
        // 只处理用户发来的文本消息，跳过 echo（我们自己发的）、回执等
        if (!event.message || event.message.is_echo) continue;

        const senderId = event.sender?.id;
        if (!senderId) continue;

        const messageText = event.message.text || (
          event.message.attachments
            ? `[${event.message.attachments.map(a => a.type).join(', ')}]`
            : '[非文本消息]'
        );
        const timestamp = new Date(event.timestamp).toLocaleString('zh-CN', { hour12: false });

        // 获取用户名称
        const userName = await getFacebookUserName(senderId);

        console.log(`[FB] 📩 ${userName}: ${messageText.substring(0, 80)}`);

        // 记录到日志文件
        logConversation('Facebook', senderId, userName, messageText);

        // 发送到飞书
        const card = buildFeishuCard('Facebook', userName, senderId, messageText, timestamp);
        await sendToFeishu(card);
      }
    }
  } catch (err) {
    console.error('[FB] 处理消息异常:', err.message);
  }
});

// ─── Line Messaging Webhook ───────────────────────────────
app.post('/webhook/line', express.json({ verify: false }), async (req, res) => {
  // 立即返回 200
  res.sendStatus(200);

  try {
    // 验证签名
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (secret) {
      const signature = req.headers['x-line-signature'];
      const bodyStr = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('SHA256', secret)
        .update(bodyStr)
        .digest('base64');
      if (signature !== expected) {
        console.warn('[Line] ⚠️ 签名验证失败，忽略请求');
        return;
      }
    }

    const { events, destination } = req.body;
    if (!events) return;

    for (const event of events) {
      if (event.type !== 'message') continue;

      const userId = event.source?.userId;
      const userMessage = event.message;
      const timestamp = new Date(event.timestamp).toLocaleString('zh-CN', { hour12: false });

      // 处理文本消息
      if (userMessage?.type === 'text') {
        const messageText = userMessage.text;
        const userName = userId ? await getLineUserName(userId) : '匿名用户';

        console.log(`[Line] 📩 ${userName}: ${messageText.substring(0, 80)}`);

        // 记录日志
        logConversation('Line', userId || '-', userName, messageText);

        // 发飞书
        const card = buildFeishuCard('Line', userName, userId, messageText, timestamp);
        await sendToFeishu(card);
      } else if (userMessage?.type) {
        // 非文本消息（图片、视频、贴图等）
        const nonTextTypes = {
          image: '🖼️ [图片]',
          video: '🎬 [视频]',
          audio: '🎵 [语音]',
          sticker: '😊 [贴图]',
          location: '📍 [位置]',
          file: '📎 [文件]'
        };
        const summary = nonTextTypes[userMessage.type] || `[${userMessage.type}]`;
        const userName = userId ? await getLineUserName(userId) : '匿名用户';

        logConversation('Line', userId || '-', userName, summary);

        const card = buildFeishuCard('Line', userName, userId, summary, timestamp);
        await sendToFeishu(card);
      }
    }
  } catch (err) {
    console.error('[Line] 处理消息异常:', err.message);
  }
});

// ============================================================
// 启动
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   FB/Line → 飞书 消息桥接服务            ║');
  console.log(`║   端口: ${PORT}                            ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('📮 端点列表：');
  console.log(`   [FB]  Webhook:   POST/GET /webhook/facebook`);
  console.log(`   [Line] Webhook:  POST      /webhook/line`);
  console.log(`   [♥]   健康检查:  GET       /health`);
  console.log('');
  console.log(`📝 对话日志目录: ${LOG_DIR}`);
  console.log('');
  if (!process.env.FEISHU_WEBHOOK_URL) {
    console.log('⚠️  未设置 FEISHU_WEBHOOK_URL，飞书通知不会发送');
  }
  if (!process.env.FB_VERIFY_TOKEN) {
    console.log('⚠️  未设置 FB_VERIFY_TOKEN，Facebook Webhook 无法验证');
  }
});
