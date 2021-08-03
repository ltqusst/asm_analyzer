var editor = CodeMirror.fromTextArea(
    document.getElementById('editor'),
    {lineNumbers: true, tabSize: 2, mode: 'gas'});

var run = document.getElementById('run');
var submit = document.getElementById('submit');
var input_step = document.getElementById('step');
var step_text = document.getElementById('step_text');



var widgets_fixed = [];
var widgets_trace = [];
var trace_log = [];
var cur_step = 0;
var cur_line = 0;

var src_has_changed_since_last_run = false;
var src_has_changed_since_last_load = false;
var loading = false;

editor.on('change', function(cm, change) {
  if (loading) return;
  if (!src_has_changed_since_last_run) {
    // first change the code since last RUN
    run.style.display = 'block';
    submit.style.display = 'none';
    //input_step.style.display = 'none';
    //step_text.style.display = 'none';
  }
  
  src_has_changed_since_last_load = true;
  src_has_changed_since_last_run = true;
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

  if (src_has_changed_since_last_load)
    submit.style.display = 'inline';
  else
    submit.style.display = 'none';
  run.style.display = 'none';  
  input_step.style.display = 'inline';
  step_text.style.display = 'inline';
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

function clearAllWidgets() {
  for (let i = 0; i < widgets_fixed.length; ++i)
    editor.removeLineWidget(widgets_fixed[i]);
  widgets_fixed.length = 0;

  for (let i = 0; i < widgets_trace.length; ++i)
    if (widgets_trace[i]) editor.removeLineWidget(widgets_trace[i]);
  widgets_trace.length = 0;
}

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


function load_trace_log(logtext, to_step = -1) {

  clearAllWidgets();

  trace_log = [];

  // parse result and add line widgets
  let cur_line = null;
  let trace_log_begin = false;

  for (let line of logtext.split('\n')) {
    if (!trace_log_begin) {
      // compile error in format  "file:line_number: reason"
      let m = line.match(/[^:]*:(\d+):\s(.*)/);
      if (m) add_widgets_fixed('compile_error', parseInt(m[1], 10) - 1, m[2]);
    }

    if (trace_log_begin && line.startsWith('[asm_analyzer]')) {
      let l = -1;
      if (cur_line) l = parseInt(cur_line.line, 10) - 1
        add_widgets_fixed('asm_analyzer', l, line.substring(15));
      continue;
    }

    let m = line.match(/^[^:]*:(\d+)\s+([\da-fA-F]+):\s+([^\n#]*)(#.*)?/);
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
    if (cur_line) cur_line.log += line + '\n';

    // console.log(`: ${line}`)
  }

  // the last line
  if (cur_line) {
    let line_no = parseInt(cur_line.line, 10)
    trace_log.push({line: line_no, log: cur_line.log})
  }

  if (to_step == -1)
    cur_step = trace_log.length
  else
    cur_step = to_step
  update_trace_log();

  run.style.display = 'none';
}


run.onclick = function() {
  let xhr = new XMLHttpRequest();
  xhr.open('POST', '/run', true);
  xhr.setRequestHeader('Content-Type', 'application/json');

  let src_code = editor.getDoc().getValue();

  xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE)
      load_trace_log(xhr.responseText);
      src_has_changed_since_last_run = false;
  };

  xhr.send(JSON.stringify({src: src_code}));
}

submit.onclick = function() {
  // relying on server to analyze it again
  let xhr = new XMLHttpRequest();
  xhr.open('POST', '/submit', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  let src_code = editor.getDoc().getValue();

  xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE){
      fetch_example_list();
      alert(xhr.responseText);
    }
  };

  xhr.send(JSON.stringify({src: src_code}));
}

// example code may have trace log already generated on server
// so we don't need a "run server" to navigate through it.
//
// an example x is composed of 2 files, x.s and x.trace
async function fetch_example(name) {
  const response_src = await fetch(`/example/${name}.s`);
  const response_trace = await fetch(`/example/${name}.trace`);

  if (!response_src.ok) {
    alert(`${name}'s source failed to load`);
    return;
  }

  if (!response_trace.ok) {
    alert(`${name}'s trace failed to load`);
    return;
  }
  
  const src = await response_src.text();
  const trace = await response_trace.text();

  src_has_changed_since_last_run = false;
  src_has_changed_since_last_load = false;

  loading = true;
  editor.getDoc().setValue(src);

  load_trace_log(trace, 0);
  loading = false;
}

async function fetch_example_list()
{
  const response = await fetch(`/examples`);
  if (!response.ok) {
    alert(`examples failed to load`);
    return;
  }
  const examples = await response.json();

  let e = document.getElementById("examples");
  e.innerHTML = '';

  for(let item of examples) {
    let htmlNode = document.createElement('a');
    htmlNode.className = 'example';
    htmlNode.innerText = item.desc;
    htmlNode.href = `#`;
    htmlNode.onclick = ()=>fetch_example(item.name);
    e.appendChild(htmlNode);
  }
}

fetch_example_list();
fetch_example("hello")
