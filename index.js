var example_asm = `
# ----------------------------------------------------------------------------------------
# GAS source file
# ----------------------------------------------------------------------------------------
    .intel_syntax noprefix

    .global _start

    .text
_start:
        
    movdqu  xmm1, data1
    movdqu  xmm2, data2
    movups  xmm0, xmm1
    cmpltps xmm0, xmm2
    blendvps xmm1,xmm2   # xmm0 is the mask

    mov     rax, 2                # system call 1 is write
    mov     rdi, 2                # file handle 1 is stdout
    cmp     rax, rdi
    je      _next
    mov     rsi,message          # address of string to output
_next:
    mov     rdx, 13               # number of bytes

    # exit(0)
    mov     rax, 60               # system call 60 is exit
    xor     rdi, rdi              # we want return code 0
    syscall                         # invoke operating system to exit

    .data
data1:
    .float 0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4
data2:
    .float 0.4, 0.3, 0.2, 0.1
message:
    .ascii  "Helloworld!\n"
`;

var editor = CodeMirror(
    document.querySelector('#editor'),
    {lineNumbers: true, tabSize: 2, value: example_asm, mode: 'gas'});

var run = document.getElementById('run');

var widgets = [];

function clearAllWidgets() {
  for (let i = 0; i < widgets.length; ++i) editor.removeLineWidget(widgets[i]);
  widgets.length = 0;
}

var waiting;
editor.on('change', function() {
  clearTimeout(waiting);
  waiting = setTimeout(clearAllWidgets, 500);
});

run.onclick = function() {
  let xhr = new XMLHttpRequest();
  xhr.open('POST', '/run', true);
  xhr.setRequestHeader('Content-Type', 'application/json');

  let src_code = editor.getDoc().getValue();

  xhr.onreadystatechange = function() {
    if (xhr.readyState == XMLHttpRequest.DONE) {
      // clear line widgets
      clearAllWidgets();

      // parse result and add line widgets
      let lines = xhr.responseText.split('\n');
      let cur_line = null;
      let trace_log_begin = false;

      for (let i = 0; i < lines.length; i++) {
        if (!trace_log_begin) {
          // compile error in format  "file:line_number: reason"
          let m = lines[i].match(/[^:]*:(\d+):\s(.*)/);
          if (m) {
            var msg = document.createElement("div");
            var icon = msg.appendChild(document.createElement("span"));
            icon.innerHTML = "!!";
            icon.className = "compile_error_icon";
            msg.appendChild(document.createTextNode(m[2]));
            msg.className = "compile_error";

            widgets.push(editor.getDoc().addLineWidget(
                parseInt(m[1], 10) - 1, msg));
          }
          if (lines[i].startsWith('tracee')) trace_log_begin = true;
        }

        let m =
            lines[i].match(/^[^:]*:(\d+)\s+([\da-fA-F]+):\s+([^\n#]*)(#.*)?/);
        if (m) {
          if (cur_line) {
            // create a node
            let htmlNode = document.createElement('pre');
            htmlNode.className = 'inline_widget';
            htmlNode.innerText = cur_line.log
            widgets.push(editor.getDoc().addLineWidget(
                parseInt(cur_line.line, 10) - 1, htmlNode));
          }
          cur_line = {
            line: m[1],
            RIP: m[2],
            disassemble: m[3],
            machine_code: m[4],
            log: ''
          };
        } else if (cur_line) {
          // every other lines are inline log
          cur_line.log += lines[i] + '\n';
        }
        // console.log(`${i}  : ${lines[i]}`)
      }
    }
  };

  xhr.send(JSON.stringify({src: src_code}));
}
