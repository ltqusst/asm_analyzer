const express = require('express')
const path = require('path');
const bodyParser = require('body-parser')
const child_process = require('child_process')
const fs = require('fs');
const glob = require('glob')
const readline = require('readline');
const util = require('util')

const app = express()
const port = 80


// list all files under example folder
var examples;

function baseName(str) {
  var base = new String(str).substring(str.lastIndexOf('/') + 1);
  if (base.lastIndexOf('.') != -1)
    base = base.substring(0, base.lastIndexOf('.'));
  return base;
}

async function getFirstLine(pathToFile) {
  const readable = fs.createReadStream(pathToFile);
  const reader = readline.createInterface({input: readable});
  const line = await new Promise((resolve) => {
    reader.on('line', (line) => {
      reader.close();
      resolve(line);
    });
  });
  readable.close();
  return line;
}

glob2 = util.promisify(glob);
exec2 = util.promisify(child_process.exec);
writeFile2 = util.promisify(fs.writeFile);
mkdtemp2 = util.promisify(fs.mkdtemp);

async function update_examples() {
  files = await glob2('./example/*.s')
  examples = [];
  for (let fpath of files) {
    desc = await getFirstLine(fpath);
    let m = desc.match(/^\s*#\s+(.*)/);
    if (m) examples.push({name: baseName(fpath), desc: m[1]});
  }
};

(async function() {
  await update_examples();
  console.log(examples);
})();

app.use(bodyParser.json());  // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({
  // to support URL-encoded bodies
  extended: true
}));

// sendFile will go here
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, '/index.html'));
});

app.get('/examples', function(req, res) {
  // list all files under example and return them
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(examples));
});

app.get('/example/*', function(req, res) {
  res.sendFile(path.join(__dirname, req.originalUrl));
});

app.get('/index.js', function(req, res) {
  res.sendFile(path.join(__dirname, '/index.js'));
});

// POST method route
app.post('/run', async function(req, res) {
  console.log(`run\n ${req.body.src}`);

  // create temp files with random name
  fs.mkdtemp('temp-', (err, folder) => {
    if (err)
      console.log(err);
    else {
      fs.writeFile(`${folder}/input.s`, req.body.src, function(err) {
        if (err) return console.log(err);

        child_process.exec(
            `./a.out ./${folder}/input.s ./${folder}/a.out`,
            function(error, stdout, stderr) {
              if (error) console.log(error);

              res.send(stderr + stdout);
              fs.rmdirSync(folder, {recursive: true});
            });
      });
    }
  });
});

// submitted example code will be stored in example folder for now (not using
// database)
app.post('/submit', async function(req, res) {
  let src = req.body.src;

  let m = src.match(/^\s*#\s*(.*)/);
  if (!m) {
    res.send('first line must be comment containing example name!');
    return;
  }

  let fname = m[1].trim().replace(/\s/g, '_');
  
  // res.send(`submit ${fname}`);
  fs.writeFile(`./example/${fname}.s`, src, function(err) {
    if (err) {
      res.send(err);
      return console.log(err);
    }
    child_process.exec(
        `./a.out ./example/${fname}.s > ./example/${fname}.trace`,
        {shell: '/bin/bash'}, async function(error, stdout, stderr) {
          if (error) {
            res.send(err);
            return console.log(error);
          }
          await update_examples();
          res.send(`${fname} is submitted!`);
        });
  });
});

app.listen(
    port, '0.0.0.0',
    () => {console.log(`Example app listening at http://localhost:${port}`)})
