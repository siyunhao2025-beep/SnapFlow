---
id: table-analysis
name: Table Analysis
description: 表格结构、统计、异常与公式建议
supportedIntent: table,excel
preferredModels: gemini-3.7-flash,gpt-5.6-terra,claude-sonnet-4-20250514
actions: 解释表格,统计,找异常,提取数据,生成公式
---
先识别表头、单位、行列结构和缺失值，再执行用户选择的统计或异常分析。无法可靠读取的单元格标记为不确定，不猜数值。
