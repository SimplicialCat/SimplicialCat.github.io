# Mineplot 0.1 — GitHub Pages 静态站点

这是完整构建后的静态站点，不需要 Node.js，也不需要构建。

## 部署到 GitHub Pages

1. 把整个 `docs/` 文件夹放到仓库根目录；如果仓库已有 `docs/`，把这里的 `index.html`、`assets/`、`.nojekyll`、`LICENSES/` 合并进去。
2. 打开仓库 Settings → Pages。
3. Build and deployment → Deploy from a branch。
4. 选择 `main` 分支和 `/docs` 目录，保存。
5. 地址：`https://<用户名>.github.io/<仓库名>/`。

如果不想使用 `/docs`，也可以把 `docs/` 里的内容复制到仓库根目录，然后在 Pages 里选择 `main` / `(root)`。

整个文件夹也可以直接以 `docs` 的名字放在仓库根目录，GitHub Pages 会直接以它作为站点根目录。

## 说明

- 需要 HTTPS 才能使用鼠标指针锁定；GitHub Pages 默认提供 HTTPS。
- 需要 WebGL2。
- 存档保存在浏览器 `localStorage`，不会上传到服务器。
- 导入/导出在存档列表中，导出文件可直接再次导入。
- 页面不是多路由应用，不需要额外的 404 配置。

## 版本

`0.1.0`（见 `VERSION`）

## 第三方素材

方块贴图来自 [ProgrammerArt](https://github.com/deathcap/ProgrammerArt)，采用 CC0 1.0 公共领域贡献。
许可证全文在 `LICENSES/ProgrammerArt-CC0.txt`。没有使用 Mojang / Minecraft 原始贴图。
