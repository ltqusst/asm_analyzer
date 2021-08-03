# hello
# Welcome to online assembler -- learn assembly instructions the easy way !
# 
#     https://github.com/ltqusst/asm_analyzer.git
#
# you can:
#     * load examples and view the trace.
#     * modify examples and re-compile & trace it on server.
#     * save your source code with trace result as another example.
#     * vote-up an example.
#
# limitations:
#     * no syscall is allowed
#     * server only executes & traces <1000 instructions
#     * only register changes are captured during the trace
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

    mov     rax, 1                # system call 1 is write
    mov     rdi, 20                # file handle 1 is stdout
_loop:
    add     rax, 1
    cmp     rax, rdi
    jl      _loop
    mov     rsi,message          # address of string to output
_next:
    mov     rdx, 13               # number of bytes

    # exit(0)
    mov     rax, 1               # system call 60 is exit
    xor     rdi, rdi              # we want return code 0
    syscall                         # invoke operating system to exit

    .data
data1:
    .float 0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4
data2:
    .float 0.4, 0.3, 0.2, 0.1
message:
    .ascii  "Helloworld!\n"
