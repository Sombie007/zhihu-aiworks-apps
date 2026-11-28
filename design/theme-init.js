/* 主题初始化：放在 <head> 里、样式表之前同步执行，避免深色模式闪白。
   优先级：URL 参数 ?theme=dark|light（便于测试和分享带主题的链接）>
   本地保存的选择 > 系统偏好。 */
(function () {
  try {
    var saved = localStorage.getItem("zdx-theme");
    var urlMatch = location.search.match(/[?&]theme=(dark|light)\b/);
    var theme = urlMatch
      ? urlMatch[1]
      : saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
