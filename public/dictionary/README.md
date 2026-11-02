# CET-4 本地词典

划词查询使用的离线中英词典，不依赖任何外部 API。

## 来源与许可

- 数据来源：[ECDICT](https://github.com/skywind3000/ECDICT)
- 许可证：MIT，见 [LICENSE-ECDICT.txt](LICENSE-ECDICT.txt)
- 生成范围：ECDICT 中带 `zk` / `gk` / `cet4` / `cet6` / `ky` 标签，或 Collins ≥ 1 / Oxford 3000 的词条；并补充本项目阅读、听力内容中出现的词。
- 条目数：15,010（含句中专有名词的精确大小写条目）
- 文件大小：约 1.28 MB
- 字段：
  - `entries[word].t`：中文释义
  - `entries[word].p`：音标（可能为空）

## 使用

前端按需 `fetch('/dictionary/cet4.json')`，加载后缓存在内存中。词库未收录的单词会提示「暂无本地释义，请手动校对」。
