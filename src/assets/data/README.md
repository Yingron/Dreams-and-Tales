# 数据目录

这里存放前端可直接加载的结构化数据。当前两个 JSON 文件只包含卡片编号、名称和图片路径，后续可继续加入：

- `description`：卡片说明；
- `tags`：主题标签；
- `requiredCharacters`：必要角色；
- `allowedScenes`：事件适配场景；
- `prerequisites`：前置事件；
- `effects`：角色状态或分数变化。

建议保持卡片 `id` 永久稳定。界面文案可修改，规则和存档应始终通过 `id` 关联。
