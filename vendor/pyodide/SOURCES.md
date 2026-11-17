# 浏览器数值运行库

- Pyodide 0.27.7，CPython 3.12.7 / WebAssembly。
- 官方发行：https://cdn.jsdelivr.net/pyodide/v0.27.7/full/
- 项目与许可证：https://github.com/pyodide/pyodide/tree/0.27.7 （MPL-2.0；CPython/NumPy/SciPy/OpenBLAS 各保留自身许可证，包内包含相关许可信息）。
- NumPy 2.0.2、SciPy 1.14.1、OpenBLAS 0.3.26；文件名、依赖与 SHA-256 保留在原版 `pyodide-lock.json`，下载时已校验三个数值包的校验值。
- 下载日期：2026-11-17。仅在用户执行暗电流拟合时加载；运行时所有文件从本站读取，不向外部服务发送测量数据。
