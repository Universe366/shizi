# 第三方素材许可

## ONNX Runtime

桌面端依赖 [onnxruntime-node](https://github.com/microsoft/onnxruntime)（MIT，Copyright (c) Microsoft Corporation）
在本机执行向量模型推理，原生库随安装包分发。

## BGE small zh v1.5

「内置向量模型」在首次使用时从 Hugging Face 按需下载
[BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)（MIT）的 ONNX 量化权重
（[Xenova 转换版](https://huggingface.co/Xenova/bge-small-zh-v1.5)），不随安装包分发；下载后做 SHA-256 校验。

## DeepSeek 大肥鱼桌宠形象

`desktop/src/renderer/src/assets/pet/` 下的图片（`keai.png`、`go_to_agi.png`、`push.png`）来自
[dsh-pet-indesktop](https://github.com/MerZlin/dsh-pet-indesktop)（原始来源
[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)），按 MIT 许可使用，
并做了等比缩放（最长边 240px）以控制安装包体积。

```
MIT License

Copyright (c) 2026 Merzlin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## KaTeX

浏览器插件内置 [KaTeX](https://github.com/KaTeX/KaTeX)（MIT，Copyright (c) 2013-2020 Khan Academy and other contributors），
用于在总结中渲染 LaTeX 公式；文件位于 `shizi-extension/vendor/katex/`，许可证随目录分发。

## FFmpeg / FFmpeg.wasm

浏览器插件使用 FFmpeg.wasm（GPL）处理音轨；桌面端使用 ffmpeg-static。具体版本与许可证以
`shizi-extension/vendor/ffmpeg/` 与 `desktop/node_modules/ffmpeg-static/` 内附文件为准。

## 交互设计参考

桌宠的情绪状态、气泡对话与主动冒泡等交互参考了以下项目，未复制其代码：

- [Coopanion](https://github.com/Pal-AI-Lab/Coopanion)（AGPL-3.0，仅作为产品形态参考）
- [dsh-pet-indesktop](https://github.com/MerZlin/dsh-pet-indesktop)（MIT）
