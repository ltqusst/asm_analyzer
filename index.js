var editor = CodeMirror.fromTextArea(
    document.getElementById('editor'),
    {lineNumbers: true, tabSize: 2, mode: 'gas'});

var run = document.getElementById('run');

var widgets_fixed = [];
var widgets_trace = [];
var trace_log = [];
var cur_step = 0;
var cur_line = 0;

var input_step = document.getElementById('step');
var step_text = document.getElementById('step_text');

var src_has_changed_since_last_run = true;

editor.on("change", function(cm, change) {
  src_has_changed_since_last_run = true;
  // show the RUN button
  run.style.display = 'block';
  input_step.style.display = 'none';
  step_text.style.display = 'none';
  editor.removeLineClass(cur_line - 1, 'background', 'cur_step')
})

input_step.oninput =
    function() {
  if (cur_step != input_step.value) {
    cur_step = input_step.value
    update_trace_log(true)
  }
}

function update_trace_log(do_scroll = false) {
  trace_byline = [];

  input_step.max = trace_log.length
  input_step.value = cur_step
  input_step.style.display = 'block';
  step_text.style.display = 'block';
  step_text.innerText = `Step:${input_step.value}/${input_step.max}`

  // collect all log until step X (only most updated trace log is kept for each
  // line)
  let new_cur_line = 0
  for (let i = 0; i < trace_log.length && i < cur_step; i++) {
    if (!trace_log[i]) continue;
    new_cur_line = trace_log[i].line;
    trace_byline[new_cur_line] = trace_log[i].log;
  }

  // remove all trace
  for (let i = 0; i < widgets_trace.length; ++i)
    if (widgets_trace[i]) editor.removeLineWidget(widgets_trace[i]);
  widgets_trace.length = 0;

  // add new traces
  /*
      consider a loop, in n'th iteration register 1 changed,
      in m'th iteration register 2 changed, what should we display
      at iteration i ?

      just display the latest delta is enough.
   */
  for (let line = 0; line < trace_byline.length; line++) {
    if (!trace_byline[line]) continue;

    let htmlNode = document.createElement('pre');
    htmlNode.className = 'inline_widget';
    htmlNode.innerText = trace_byline[line]
    widgets_trace.push(editor.getDoc().addLineWidget(line - 1, htmlNode));
  }

  editor.removeLineClass(cur_line - 1, 'background', 'cur_step')
  editor.addLineClass(new_cur_line - 1, 'background', 'cur_step')
  cur_line = new_cur_line;

  editor.scrollIntoView({line: cur_line})
}

function
clearAllWidgets() {
  for (let i = 0; i < widgets_fixed.length; ++i)
    editor.removeLineWidget(widgets_fixed[i]);
  widgets_fixed.length = 0;

  for (let i = 0; i < widgets_trace.length; ++i)
    if (widgets_trace[i]) editor.removeLineWidget(widgets_trace[i]);
  widgets_trace.length = 0;
}

var waiting;
editor.on('change', function() {
  clearTimeout(waiting);
  waiting = setTimeout(clearAllWidgets, 500);
});

function add_widgets_fixed(className, line_number, text) {
  let msg = document.createElement('div');
  let icon = msg.appendChild(document.createElement('span'));
  icon.innerHTML = 'ii';
  icon.className = className + '_icon';
  msg.appendChild(document.createTextNode(text));
  msg.className = className;

  let options = {};
  if (line_number < 0) {
    line_number = 0;
    options.above = true;
  }
  widgets_fixed.push(editor.getDoc().addLineWidget(line_number, msg, options));
}

run.onclick = function() {
  let xhr = new XMLHttpRequest();
  xhr.open('POST', '/run', true);
  xhr.setRequestHeader('Content-Type', 'application/json');

  let src_code = editor.getDoc().getValue();

  xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE) {
      // clear line widgets
      clearAllWidgets();

      trace_log = [];

      // parse result and add line widgets
      let lines = xhr.responseText.split('\n');
      let cur_line = null;
      let trace_log_begin = false;

      for (let i = 0; i < lines.length; i++) {
        if (!trace_log_begin) {
          // compile error in format  "file:line_number: reason"
          let m = lines[i].match(/[^:]*:(\d+):\s(.*)/);
          if (m)
            add_widgets_fixed('compile_error', parseInt(m[1], 10) - 1, m[2]);
        }

        if (lines[i].startsWith('[asm_analyzer]')) {
          let l = -1;
          if (cur_line) l = parseInt(cur_line.line, 10) - 1
            add_widgets_fixed('asm_analyzer', l, lines[i].substring(15));
          continue;
        }

        let m =
            lines[i].match(/^[^:]*:(\d+)\s+([\da-fA-F]+):\s+([^\n#]*)(#.*)?/);
        if (m) {
          if (cur_line) {
            // create a temporary log in trace_log
            let line_no = parseInt(cur_line.line, 10)
            trace_log.push({line: line_no, log: cur_line.log})
          }
          cur_line = {
            line: m[1],
            RIP: m[2],
            disassemble: m[3],
            machine_code: m[4],
            log: ''
          };
          trace_log_begin = true;
          continue;
        }

        // every other lines are inline log
        if (cur_line) cur_line.log += lines[i] + '\n';

        // console.log(`${i}  : ${lines[i]}`)
      }

      // the last line
      if (cur_line) {
        let line_no = parseInt(cur_line.line, 10)
        trace_log.push({line: line_no, log: cur_line.log})
      }

      cur_step = trace_log.length
      update_trace_log();

      run.style.display = 'none';
      /*
      cur_step = 0;
      setInterval(function() {
        cur_step++;
        update_trace_log();
      }, 1000);
      */
    }
  };

  xhr.send(JSON.stringify({src: src_code}));
}
