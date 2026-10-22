# Mineplot 0.2 — GitHub Pages 静态站点

这是完整构建后的静态站点，不需要 Node.js，也不需要构建。

## 部署到 GitHub Pages

1. 把整个 `docs/` 文件夹放到仓库根目录；如果仓库已有 `docs/`，把这里的 `index.html`、`assets/`、`.nojekyll`、`LICENSES/`、`VERSION` 和 `README.md` 合并进去。
2. 打开仓库 Settings → Pages。
3. Build and deployment → Deploy from a branch。
4. 选择 `main` 分支和 `/docs` 目录，保存。
5. 地址：`https://<用户名>.github.io/<仓库名>/`。

如果不想使用 `/docs`，也可以把 `docs/` 里的内容复制到仓库根目录，然后在 Pages 里选择 `main` / `(root)`。

整个文件夹也可以直接以 `docs` 的名字放在仓库根目录，GitHub Pages 会直接以它作为站点根目录。

## 0.2 更新

- 点、线段、曲线和面可以设置颜色、点大小、线粗细、面厚薄。
- 外观对话框提供推荐色、色轮、饱和度和纯白；内置只显示当前对象的网格预览，可拖动旋转。
- 格式刷支持左键读取、右键应用。
- 面使用受光材质，接收光照和阴影；有厚度的面投射阴影，零厚度面只接收。
- 行走模式可以站立和行走在斜向平面上；面是实体障碍，会从正面、背面和下方推挤玩家。
- 自动踏步高度为 0.5 格。
- 建造模式可以对着多边形面放置方块，位置取整到整数格。
- 修复普通地面跳跃、面碰撞过度推挤等问题。

## 说明

- 需要 HTTPS 才能使用鼠标指针锁定；GitHub Pages 默认提供 HTTPS。
- 需要 WebGL2。
- 存档保存在浏览器 `localStorage`，不会上传到服务器。
- 导入/导出在存档列表中，导出文件可直接再次导入。
- 页面不是多路由应用，不需要额外的 404 配置。

## 版本

`0.2.0`（见 `VERSION`）

## 第三方素材

方块贴图来自 [ProgrammerArt](https://github.com/deathcap/ProgrammerArt)，采用 CC0 1.0 公共领域贡献。
许可证全文在 `LICENSES/ProgrammerArt-CC0.txt`。没有使用 Mojang / Minecraft 原始贴图。

three.js 以 MIT 许可证分发，许可证全文在 `LICENSES/three-MIT.txt`。
