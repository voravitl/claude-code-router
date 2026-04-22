# Prompt Optimization & Orchestration System

ระบบ Transformer ที่ครอบคลุมสำหรับ Claude Code Router เพื่อทำ **Prompt Optimization** และ **Intelligent Orchestration**

## 📦 ไฟล์ที่สร้าง

```
~/.claude-code-router/
├── plugins/
│   ├── prompt-optimizer.transformer.js    # ปรับโครงสร้าง prompt
│   ├── response-optimizer.transformer.js  # ปรับ response ก่อนส่งกลับ
│   ├── token-optimizer.transformer.js     # จัดการ token efficiency
│   └── orchestrator-router.js             # Intelligent model routing
└── config.optimized.example.json          # ตัวอย่าง config
```

## 🎯 ฟีเจอร์หลัก

### 1. Prompt Optimizer Transformer

**หน้าที่:**
- วิเคราะห์ประเภทของ request (code, debug, plan, test, etc.)
- เพิ่ม Role Prompt ที่เหมาะสม
- เพิ่ม Chain of Thought สำหรับงานซับซ้อน
- จัดโครงสร้าง prompt ให้ชัดเจน
- บีบอัด prompt ลด tokens ที่ไม่จำเป็น

**การเปิดใช้งาน:**
```json
{
  "transformers": [{
    "path": "~/.claude-code-router/plugins/prompt-optimizer.transformer.js",
    "options": {
      "enableRolePrompt": true,
      "enableStructuredPrompt": true,
      "enableChainOfThought": true,
      "enableCompression": true
    }
  }]
}
```

### 2. Response Optimizer Transformer

**หน้าที่:**
- เพิ่ม metadata (timestamp, token usage, processing time)
- Enhance error response ด้วยคำแนะนำ
- กรอง content ที่ไม่จำเป็น
- Optimize streaming response

**การเปิดใช้งาน:**
```json
{
  "transformers": [{
    "path": "~/.claude-code-router/plugins/response-optimizer.transformer.js",
    "options": {
      "enableMetadata": true,
      "enableErrorEnhancement": true,
      "enableStreamOptimization": true
    }
  }]
}
```

### 3. Token Optimizer Transformer

**หน้าที่:**
- นับและติดตาม token usage
- บีบอัด text เมื่อใกล้เกิน limit
- จัดการ conversation history (truncate/preserve)
- รายงานสถิติ token

**การเปิดใช้งาน:**
```json
{
  "transformers": [{
    "path": "~/.claude-code-router/plugins/token-optimizer.transformer.js",
    "options": {
      "maxContextTokens": 100000,
      "compressionThreshold": 0.8,
      "enableCompression": true,
      "enableHistoryTruncation": true
    }
  }]
}
```

### 4. Orchestrator Router (Ollama Exclusive)

**หน้าที่:**
- วิเคราะห์ความซับซ้อนของ task
- เลือกโมเดล Ollama ที่เหมาะสมจาก config
- **ไม่ใช้ API key** - ใช้เฉพาะ Ollama models เท่านั้น

**Routing Logic (Ollama Only):**
| Task Type | Model (จาก config) |
|-----------|---------------------|
| Long Context (>40K tokens) | `Router.longContext` |
| Planning/Architecture | `Router.think` |
| Debugging | `Router.code` |
| Code Generation | `Router.code` |
| Simple Query | `Router.background` |
| Testing/Documentation | `Router.default` |
| Code Review | `Router.think` |
| Image (vision) | `Router.image` |

**ตัวอย่าง Config (Ollama Only):**
```json
{
  "Providers": [{
    "name": "ollama",
    "api_base_url": "http://localhost:11434/v1/chat/completions",
    "api_key": "ollama",
    "models": ["qwen2.5-coder:latest", "llama3.2:3b", "deepseek-r1:latest"]
  }],
  "Router": {
    "default": "qwen2.5-coder:latest",
    "background": "llama3.2:3b",
    "think": "deepseek-r1:latest",
    "code": "qwen2.5-coder:latest",
    "longContext": "command-r:latest"
  },
  "CUSTOM_ROUTER_PATH": "~/.claude-code-router/plugins/orchestrator-router.js"
}
```

**การเปิดใช้งาน:**
```json
{
  "CUSTOM_ROUTER_PATH": "~/.claude-code-router/plugins/orchestrator-router.js"
}
```

## 🚀 การติดตั้ง

### ขั้นตอนที่ 1: คัดลอกไฟล์

```bash
# ตรวจสอบว่าไฟล์ถูกสร้างใน ~/.claude-code-router/plugins/
ls -la ~/.claude-code-router/plugins/
```

### ขั้นตอนที่ 2: แก้ไข config

```bash
# เปิด config
ccr ui

# หรือแก้ไขด้วยมือ
nano ~/.claude-code-router/config.json
```

เพิ่ม/แก้ไข:
```json
{
  "transformers": [
    {
      "path": "~/.claude-code-router/plugins/prompt-optimizer.transformer.js",
      "options": {
        "enableRolePrompt": true,
        "enableStructuredPrompt": true,
        "enableChainOfThought": true,
        "enableCompression": true
      }
    },
    {
      "path": "~/.claude-code-router/plugins/response-optimizer.transformer.js",
      "options": {
        "enableMetadata": true,
        "enableErrorEnhancement": true,
        "enableStreamOptimization": true
      }
    },
    {
      "path": "~/.claude-code-router/plugins/token-optimizer.transformer.js",
      "options": {
        "maxContextTokens": 100000,
        "compressionThreshold": 0.8,
        "enableCompression": true,
        "enableHistoryTruncation": true
      }
    }
  ],
  "CUSTOM_ROUTER_PATH": "~/.claude-code-router/plugins/orchestrator-router.js"
}
```

### ขั้นตอนที่ 3: รีสตาร์ท

```bash
ccr restart
```

## 📊 การตรวจสอบ

### ดู Logs
```bash
tail -f ~/.claude-code-router/claude-code-router.log
```

### ดู Token Stats (จาก Token Optimizer)
```javascript
// ใน transformer สามารถเรียก
const stats = tokenOptimizer.getTokenStats();
console.log(stats);
// { totalRequests: 100, totalTokens: 50000, savedTokens: 5000, ... }
```

## ⚙️ การปรับแต่ง

### ปรับ Prompt Optimizer
```javascript
{
  "enableRolePrompt": false,      // ปิด role prompt
  "enableChainOfThought": false,  // ปิด CoT
  "enableCompression": true       // เปิด compression
}
```

### ปรับ Token Optimizer
```javascript
{
  "maxContextTokens": 50000,      // ลด limit
  "compressionThreshold": 0.9,    // เริ่มบีบอัดที่ 90%
  "preserveSystemPrompt": true    // เก็บ system prompt เสมอ
}
```

### เพิ่ม Task Types ใน Orchestrator

แก้ไข `orchestrator-router.js` เพิ่ม pattern ใน `taskAnalysis`:
```javascript
const taskAnalysis = {
  // ... existing ...
  isCustomTask: /your-pattern/i.test(fullContext)
};
```

## 🔧 การแก้ไขปัญหา

### Transformer ไม่ทำงาน
1. ตรวจสอบ path ใน config ว่าถูกต้อง
2. ตรวจสอบว่า transformer มี `name` property
3. ดู logs: `~/.claude-code-router/claude-code-router.log`

### Router ไม่เลือกโมเดลที่คาดหวัง
1. ตรวจสอบว่า model มีใน Providers
2. ตรวจสอบลำดับ routing logic (สำคัญ)
3. เพิ่ม logging ใน router เพื่อดีบัก

### Token Compression ทำงานมากเกินไป
- เพิ่ม `compressionThreshold` (เช่น 0.9 แทน 0.8)
- ลด `maxContextTokens`
- เปิด `preserveSystemPrompt: true`

## 📈 ประโยชน์ที่คาดหวัง

| ด้าน | ก่อน | หลัง |
|------|------|------|
| Token Usage | 100% | 70-85% (ลด 15-30%) |
| Model Cost | ใช้โมเดลแพงทุกงาน | ใช้โมเดลเหมาะสมตาม task |
| Response Quality | ทั่วไป | มี structure ชัดเจน |
| Error Handling | แก้ไขยาก | มีคำแนะนำชัดเจน |

## 🎓 ตัวอย่างการใช้งาน

### งานเขียนโค้ด
```
User: "เขียน function sort array ใน Python"
→ Prompt Optimizer: เพิ่ม role prompt + structured format
→ Orchestrator: เลือก deepseek-chat (ประหยัด)
```

### งาน Debug
```
User: "แก้บั๊กนี้ให้หน่อย [error stack...]"
→ Prompt Optimizer: เพิ่ม chain of thought
→ Orchestrator: เลือก claude-3.5-sonnet (เก่ง debug)
```

### งาน Planning
```
User: "ออกแบบ architecture สำหรับระบบ auth"
→ Prompt Optimizer: เพิ่ม role prompt + structured format
→ Orchestrator: เลือก deepseek-reasoner (เก่ง reasoning)
```

## 📝 License

ใช้ร่วมกับ Claude Code Router ภายใต้ license เดียวกัน
