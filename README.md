#!name=AI 与流媒体解锁检测
#!desc=检测当前出口对 Claude、Gemini、OpenAI、YouTube 与 Netflix 的状态
#!system=ios,mac

[Panel]
ai-unlock = script-name=ai-unlock,title=节点解锁检测,content="点击刷新检测",style=info,update-interval=-1

[Script]
ai-unlock = type=generic,timeout=10,script-path=ai_unlock.js
