# 图片资源约定

- `baishe/`：白蛇传正式卡片，采用一位编号（如 `S1.png`、`C4.png`）；
- `baishe/variants/`：暂未作为正式卡片使用的备选图；
- `kongque/`：孔雀东南飞正式卡片，采用两位编号（如 `S01.png`、`C04.png`、`E22.png`）。

新增或替换图片时请保持编号位数不变。卡片名称、来源文件名和标准文件名的完整对照见 `docs/card-id-reference.md`。

为控制 GitHub Pages 加载时间，后续正式上线前建议在不改变文件名的前提下压缩图片，或统一输出 WebP 并同步修改数据文件中的 `image` 路径。
