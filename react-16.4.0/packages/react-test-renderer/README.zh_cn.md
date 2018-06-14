# `react-test-renderer`

该包提供了一个实验性的 React 渲染器，可以用来将 React 组件渲染成纯 JavaScript 对象，不需要依赖于 DOM 和原生移动环境。

本质上，该包可以在无需使用浏览器或 jsdom 的情况下，轻松地抓取由 React DOM 或 React Native 渲染出的平台视图层次结构（类似于DOM树）。

文档:

[https://reactjs.org/docs/test-renderer.html](https://reactjs.org/docs/test-renderer.html)

使用:

```jsx
const ReactTestRenderer = require('react-test-renderer');

const renderer = ReactTestRenderer.create(
  <Link page="https://www.facebook.com/">Facebook</Link>
);

console.log(renderer.toJSON());
// { type: 'a',
//   props: { href: 'https://www.facebook.com/' },
//   children: [ 'Facebook' ] }
```

你还可以可以使用 Jest 的快照测试功能自动将 JSON 树的副本保存到文件中，并检查测试是否未更改： https://facebook.github.io/jest/blog/2016/07/27/jest-14.html。

# 译者参考
- https://doc.react-china.org/docs/test-renderer.html