(function () {
  'use strict';
  var panel = document.querySelector('.note-search');
  if (!panel) return;
  var input = document.getElementById('note-query');
  var items = Array.from(document.querySelectorAll('.note-index-item'));
  var topic = 'All';
  function filter() {
    var query = input.value.trim().toLocaleLowerCase();
    var count = 0;
    items.forEach(function (item) {
      var text = item.textContent.toLocaleLowerCase();
      var matchesTopic = topic === 'All' || (item.dataset.topics || '').split(' ').includes(topic);
      item.hidden = !(matchesTopic && text.includes(query));
      if (!item.hidden) count++;
    });
    document.getElementById('note-results').textContent = document.documentElement.lang === 'en'
      ? count + ' notes' + (count === 0 ? '. Try another keyword or topic.' : '')
      : count + '件' + (count === 0 ? '：キーワードやテーマを変えてみてください。' : 'の記事');
  }
  panel.hidden = false;
  input.addEventListener('input', filter);
  panel.querySelectorAll('[data-topic]').forEach(function (button) {
    button.addEventListener('click', function () {
      topic = button.dataset.topic;
      panel.querySelectorAll('[data-topic]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      filter();
    });
  });
  filter();
}());
