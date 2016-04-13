/**
 *
 * Created by Luke Huang on 2015/7/13.
 *
 */


module.exports = function (app, config) {

  var request = require('request');
  require('request-debug')(request);
  var q = require('q');
  var Buffer = require('buffer').Buffer;


  var config = config ||
    {
      'PROJECT_ID': '42520',
      'ACTIVITI_API': 'http://140.92.88.105:8080/activiti-webapp-explorer/',
      'ACTIVITI_REST_API': 'http://140.92.88.105:8080/activiti-webapp-rest2/',
      'CONFIG_USERS_API': 'http://api.vztaiwan.com:80/api/users/',
      'CONFIG_ROLES_API': 'http://api.vztaiwan.com:80/api/Roles/',
      'CONFIG_RESOURCES_API': 'http://api.vztaiwan.com:80/api/Resources/'

      // 'PROJECT_ID': '93816',
      // 'ACTIVITI_API': 'http://140.92.53.42:8080/activiti-webapp-explorer2/',
      // 'ACTIVITI_REST_API': 'http://140.92.53.42:8080/activiti-webapp-rest/'

    };


  function encodeBase64Auth(name, pass) {
    var encodingBuff = new Buffer(name + ':' + pass);
    var encodingStr = encodingBuff.toString('base64');
    return 'Basic ' + encodingStr;
  }

  var router = app.loopback.Router();
  var User = app.models.User;
  var Resource = app.models.Resource;

  //
  // Configuration stage: Query service configuration, get default Anonymous role , get process role in app and
  // query processDefinitionId by processDefinitionKey.
  //
  router.use(function (req, res, next) {

    req.accessToken = req.query.access_token || req.body.access_token || '';

    q.promise(function (resolve, reject) {
        // Configuration stage step 1:  query service configuration (API)
        // request configuration
        request(config.ACTIVITI_API + 'service/configuration/' + config.PROJECT_ID, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            var data = JSON.parse(body);
            req.configuration = data;
            console.log('================>>> Request activiti confifuration:', JSON.stringify(req.configuration));
            resolve(true);
          }
          else {
            console.error('================>>> Request ACTIVITI_API service/configuration error', error);
            reject(false);
          }
        })
      })
      .then(function () {
        // Configuration stage step 2:  Get default getAnonymous role
        return q.promise(function (resolve, reject) {
          request(req.configuration.resource + 'getAnonymous', function (error, response, body) {
            if (!error && response.statusCode == 200) {
              var data = JSON.parse(body);

              req.anonymousRole = data;     // cache anonymous role info in req.anonymousRole
              // if(!req.accessToken)          //
              //   req.role = [data];          //

              console.log('================>>> Request API getAnonymous success! Anonymous role:', JSON.stringify(data));
              resolve(true);
            }
            else {
              console.error('================>>> Request activiti configuration resource api getAnonymous error ', error);
              reject(false);

            }
          });
        });
      })
      .then(function () {
        // Configuration stage step 3: get process Role in app
        // if login,  getMyResource

        req.role = [];
        if (req.accessToken) {
          // var User = app.models.user;
          // 無法透過 app.models.user getMyRoles (ctx問題) 先以發 request 取得Roles
          return q.promise(function (resolve, reject) {
            var queryObject = {"access_token": req.accessToken};   // login user
            request({
              "url": req.configuration.user + 'getMyResource',
              "qs": queryObject
            }, function (error, response, body) {
              if (!error && response.statusCode == 200) {
                var resourceList = JSON.parse(body);
                var roleAccountList = [];
                resourceList.forEach(function (resource) {
                  if (resource.type == 'processRole' && resource.bpmAccount) {
                    roleAccountList.push(resource);
                  }
                  // pass else resources
                });

                console.log('================>>> Request API getMyResource success! App roleResourceList list:', JSON.stringify(roleAccountList));
                req.role = roleAccountList;

                resolve(true);
              }
              else {
                console.error('================>>> Request activiti configuration user api getMyResource error', error);
                reject(response);
              }
            });

          })
        }
        else {
          console.log('================>>> No access_token fetched...');
          return true;    // go to next stage
        }

      })
      .then(function () {
          console.log('================>>> Configuration stage Done. ');
          next();

        }
        , function (error) {
          console.error('===>>> Role query error ', error);
          if (!error) {
            error = {"statusCode": 404}
          }
          res.status(error.statusCode).send({
            'status': 404,
            'description': 'Role query error, please check your accessToken.'
          }).end();

        });


  });

  // /
  router.get('/', function (req, res, next) {

    console.log('================>>> in /activiti/');
    next();

  });

  // test s3-activiti-middleware alive
  router.get('/test', function (req, res, next) {
    console.log('================>>> in /activiti/test');
    res.status(200).send(new Date().toJSON()).end();
  });

  // Get list of process definition key by project ID
  router.get('/query/processDefinitionsByProjectId*', function (req, res, next) {
    console.log('================>>> in /activiti/query/processDefinitionsByProjectId');
    // example: http://140.92.88.157:8080/activiti-webapp-rest/service/query/process-definition-key/819
    // config.ACTIVITI_REST_API
    var processRole = {
      bpmAccount: "Anonymous",
      bpmPassword: "Anonymous"
    };
    // GET process-definition method need to login, but no specific.

    var queryProjectId = req.url.split('/query/processDefinitionsByProjectId')[1]; // projectID
    request({
        "url": config.ACTIVITI_REST_API + 'service/query/process-definition-key' + queryProjectId,
        "headers": {"Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword)}
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('===>>> Query process definition list by projectID success! body:', body);
          res.send(body).end();
        } else {
          console.error('===>>> Query process definition list by projectID error, ', error);
          res.status(500).send(
            {
              "status": "500",
              "description": "Query process definition list by projectID error... ",
              "error": error
            }).end();
        }
      });

  });

  // Create process instance
  router.post('/runtime/process-instances*', function (req, res, next) {

    console.log('================>>> in POST /runtime/process-instances');
    //
    // create process step 1 : query processDefinitionId for check identitylinks
    //
    q.promise(function (resolve, reject) {

      var processDefinitionKey = req.body.processDefinitionKey || req.query.processDefinitionKey || ''; // get processDefinitionKey
      var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;  // choosing a role to query processDefinitionId
      // GET process-definition method need to login, but no specific.

      if (processDefinitionKey && processRole.bpmAccount) {
        console.log('===>>> Trying to request the latest actviti processDefinitionId by process role >>> acct: ',
          processRole.bpmAccount, ' pwd: ', processRole.bpmPassword);
        request({
            "url": config.ACTIVITI_REST_API + 'service/repository/process-definitions?key=' + processDefinitionKey + '&latest=true',
            "headers": {"Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword)}
          },
          function (error, response, body) {
            if (!error && response.statusCode == 200) {
              var data = JSON.parse(body);
              if (data.data.length > 0) {
                req.processDefinitionId = data.data[0].id;  //  get the latest process definition id
                console.log('===>>> Request the latest actviti processDefinitionId by processDefinitionkey success, Id: ', req.processDefinitionId);
                resolve(true);
              }
              else {
                console.log('===>>> No processDefinitionId for processDefinitionkey: ' + processDefinitionKey);
                res.status(404).send(
                  {
                    "status": "404",
                    "description": "No processDefinitionId for processDefinitionkey: " + processDefinitionKey
                  }).end();
                //reject(false);
              }
            } else {
              console.error(error);
              res.status(404).send(
                {
                  "status": "404",
                  "description": "Query processDefinitionId by processDefinitionkey error... "
                }).end();
              //reject(false);
            }
          });
      }
      else {
        console.error('===>>> NO processDefinitionKey to query the latest processDefinitionId...');
        res.status(404).send(
          {
            "status": "404",
            "description": "NO processDefinitionKey to query the latest processDefinitionId..."
          }).end();
        // reject(false);
      }

    }).then(function () {
      //
      // create process step 2 : get candidate list
      // Get involved people for process instance :  processDefinitionId + '/identitylinks'
      return q.promise(function (resolve, reject) {

        var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
        // choosing a role to query processDefinitionId
        // GET process-definition method need to login, but no specific.

        request({
            "url": config.ACTIVITI_REST_API + 'service/repository/process-definitions/' + req.processDefinitionId + '/identitylinks',
            "headers": {"Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword)}
          },
          function (error, response, body) {
            if (!error && response.statusCode == 200) {
              console.log('===>>>  Request process identitylinks by processDefinitionId success! start to create process.');
              var candidateList = JSON.parse(body);
              req.candidateList = candidateList;                    //
              resolve(true);
              // candidate checking => before create process-instance, each role.

            } else {
              console.error('===>>> Request process identitylinks by processDefinitionId error... processDefinitionId: ', req.processDefinitionId);
              console.error(error);
              res.status(response.statusCode).send(
                {
                  "status": response.statusCode,
                  "description": "Process identitylinks query error...   processDefinitionId: " + req.processDefinitionId
                }).end();
              // reject(false);
            }
          });
      });
    }).then(function () {

      // create process in role sequence.

      var i = 0;
      var errorHistory = [];

      function createProcess(i) {

        // check role[i] is valid
        if (i < req.role.length)
          var processRole = ( req.role.length > 0 && req.role[i] ) ? req.role[i] : req.anonymousRole;
        else if (i == req.role.length) {
          var processRole = req.anonymousRole;
        }

        console.log('===>>> Trying to create process-instance by processRole: ', processRole);
        console.log('===>>> Checking process role with candidateList:', req.candidateList);

        var candidateFlag = false;
        var candidateList = req.candidateList;
        if (candidateList && candidateList.length > 0) {
          candidateList.forEach(function (candidateItem) {
            if (candidateItem.user && candidateItem.user === processRole.bpmAccount) {
              candidateFlag = true;
            }
          });
        }
        if (candidateFlag) {
          console.log('===>>> candidate pass! processRole: ', JSON.stringify(processRole));
        }

        if ((candidateFlag && processRole.bpmAccount) || processRole == 'Anonymous') {
          q.promise(function (resolve, reject) {

            request({
                "method": 'POST',
                "url": config.ACTIVITI_REST_API + 'service/runtime/process-instances',
                "headers": {
                  "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
                  'content-type': 'application/json'
                },
                "json": true,
                "body": req.body
              },
              function (error, response, body) {
                if (!error && response.statusCode == 201) {     // statusCode 201: created process successful
                  console.log('===>>> Created process instance successful!', JSON.stringify(body));
                  res.status(201).send(body).end();
                } else {
                  resolve(response);
                  //res.status(response.statusCode).send(body).end();
                }
              });

          }).then(function (response) {
            // response is create process error or failed reason by Activiti
            // keep failed reason & error in errorHistory array
            var errorObj = {
              "processRole": processRole,
              "response": response
            };
            errorHistory.push(errorObj);

            if (processRole !== 'Anonymous' && i < req.role.length) {
              i++;
              createProcess(i);
            }
            else {
              console.log('===> Trying Anonymous role to create process failed too.');
              var finalResponse = {
                message: "No suitable process role to create process, or error happened when creating process.",
                errorHistory: errorHistory
              };
              res.status(404).send(finalResponse).end();
            }

          });
        }
        else {
          // pass, current role is not in current candidateList of process
          if (i < req.role.length) {
            i++;
            createProcess(i);
          }
          else {
            var finalResponse = {
              message: "No suitable process role to create process, or error happened when creating process.",
              errorHistory: errorHistory
            };
            res.status(404).send(finalResponse).end();
          }
        }

      }

      createProcess(i); //

    });


  });

  // List of process instances
  router.get('/runtime/process-instances*', function (req, res, next) {
    //
    // Get process instance list or get process-instance by id, whatever task & role.
    //
    var queryParam = req.url.split('/runtime/process-instances')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    // GET process-instances method need to login, but no specific.

    console.log('================>>> in GET /runtime/process-instances and query params:', queryParam);
    console.log('===>>> Trying to GET process-instance by process role >>> acct: ', processRole.bpmAccount, ' pwd: ', processRole.bpmPassword);
    // request activiti process list
    request({
        "method": 'GET',
        "url": config.ACTIVITI_REST_API + 'service/runtime/process-instances' + queryParam,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          'content-type': 'application/json'
        },
        json: true
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('List process instance successful!');
          res.status(200).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });

  });

  // Query process instance
  router.post('/query/process-instances*', function (req, res, next) {
    // POST query/process-instances

    var queryParameters = req.url.split('/query')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    // QUERY process-instances method need to login, but no specific.

    console.log('================>>> in POST /query/process-instance* queryParameters: ', queryParameters);
    console.log('================>>> Trying to query process-instance by Role', processRole.bpmAccount, processRole.bpmPassword);

    // request
    request({
        "method": 'POST',
        "url": config.ACTIVITI_REST_API + 'service/query' + queryParameters,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          "content-type": 'application/json'
        },
        "json": true,
        "body": req.body
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('Query process-instance* success!!');
          res.status(200).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });

  });

  // GET runtime/tasks
  router.get('/runtime/tasks*', function (req, res, next) {

    var queryParameters = req.url.split('runtime/tasks')[1];
    console.log('================>>> in GET /runtime/tasks queryParameters: ', queryParameters);

    var i = 0;

    function queryTasks(i) {
      var role = req.role[i];

      q.promise(function (resolve, reject) {
        var newQueryParameters = '';
        // auto append assignee
        if (!req.query.assignee) {
          newQueryParameters = queryParameters + '&assignee=' + role.bpmAccount;
          // newQueryParameters = queryParameters + '&includeTaskLocalVariables=true';
          console.log('append assignee to query params new queryParameters', newQueryParameters);
        }

        // request
        request({
            "method": 'GET',
            "url": config.ACTIVITI_REST_API + 'service/runtime/tasks' + newQueryParameters,
            "headers": {
              "Authorization": encodeBase64Auth(role.bpmAccount, role.bpmPassword),
              'content-type': 'application/json'
            },
            json: true
          },
          function (error, response, body) {
            if (!error && response.statusCode == 200) {
              console.log('Get runtime tasks!');
              res.status(200).send(body).end();
            } else {
              resolve(response);
              // res.status(response.statusCode).send(body).end();
            }
          });

      }).then(function (response) {
        i++;
        if (i < req.role.length) {
          queryTasks(i);
        }
        else {
          if (req.role.length > 1) {
            // 試過所有身份沒有任何結果表示無任何屬於他的task
            res.status(204).send().end();
          }
          if (role.bpmAccount == 'Anonymous' && req.role.length == 1) {
            // 只有 Anonymous 身份（或未登入）
            res.status(200).send({
              'statusCode': 200,
              'description': 'No tasks for Anonymous.'
            }).end();
          }
          else {
            // default response false
            res.status(response.statusCode).send(response.body).end();
          }
        }
      });
    }

    if (req.role.length > 0)
      queryTasks(i);
    else {
      req.role.push(req.anonymousRole);
      queryTasks(i);
    }

  });

  // Query tasks
  router.post('/query/tasks*', function (req, res, next) {
    // POST query/tasks

    var queryParameters = req.url.split('/query')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    // QUERY process-instances method need to login, but no specific.

    console.log('================>>> in POST /query/tasks* queryParameters: ', queryParameters);
    console.log('================>>> Trying to query tasks by Role', processRole.bpmAccount, processRole.bpmPassword);

    // request
    request({
        "method": 'POST',
        "url": config.ACTIVITI_REST_API + 'service/query' + queryParameters,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          "content-type": 'application/json'
        },
        "json": true,
        "body": req.body
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('Query tasks* success!!');
          res.status(200).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });

  });

  // POST runtime/tasks/{taskId}
  router.post('/runtime/tasks*', function (req, res, next) {


    var taskId = req.url.split('runtime/tasks')[1].split('?')[0];
    console.log('================>>> in POST /runtime/tasks and taskId:', taskId);


    function getTaskById(i, resolve, reject) {
      var role = req.role[i] ? req.role[i] : req.anonymousRole;

      q.promise(function (resolve, reject) {

        // request
        if (role.bpmAccount !== 'Anonymous') {
          console.log('================>>> Trying to get task by id, and use Role:', role.bpmAccount, role.bpmPassword);
          request({
              "method": 'GET',
              "url": config.ACTIVITI_REST_API + 'service/runtime/tasks' + taskId,
              "headers": {
                "Authorization": encodeBase64Auth(role.bpmAccount, role.bpmPassword),
                'content-type': 'application/json'
              },
              "json": true,
              "body": req.body
            },
            function (error, response, body) {
              if (!error && response.statusCode == 200) {

                // res.status(200).send(body).end();
                resolve(body);
              } else {
                resolve(response);
                // res.status(response.statusCode).send(body).end();
              }
            });
        }
        else {
          console.log('skip Anonymous role...');
          resolve(false);        // skip Anonymous

        }
      }).then(function (response) {
        i++;
        if (i < req.role.length) {
          getTaskById(i, resolve, reject);
        }
        else {
          console.log('Get task detail', response); // get response
          resolve(response);
        }

      });
    }

    // Get task detail to check assignee
    q.promise(function (resolve, reject) {
        var i = 0;
        if (req.role.length > 0)
          getTaskById(i, resolve, reject);
        else {
          req.role.push(req.anonymousRole);
          getTaskById(i, resolve, reject);
        }

      })
      .then(function (task) {

        var roleIndex = 0;

        for (var i = 0; i < req.role.length; i++) {
          if (req.role[i].bpmAccount == task.assignee)
            roleIndex = i;
        }

        var role = req.role[roleIndex];
        q.promise(function (resolve, reject) {
          request({
              "method": 'POST',
              "url": config.ACTIVITI_REST_API + 'service/runtime/tasks' + taskId,
              "headers": {
                "Authorization": encodeBase64Auth(role.bpmAccount, role.bpmPassword),
                'content-type': 'application/json'
              },
              "json": true,
              "body": req.body
            },
            function (error, response, body) {
              if (!error && response.statusCode == 200) {

                res.status(200).send(body).end();
              } else {
                res.status(response.statusCode).send(body).end();
              }
            });
        }).then(function () {

        });

      });


  });

  // GET runtime/executions
  router.get('/runtime/executions*', function (req, res, next) {

    var queryParameters = req.url.split('runtime/executions')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    console.log('================>>> in GET /runtime/executions');
    // request
    request({
        "method": 'GET',
        "url": config.ACTIVITI_REST_API + 'service/runtime/executions' + queryParameters,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          'content-type': 'application/json'
        },
        json: true
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('Get runtime executions!');
          res.status(200).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });

  });

  // Delete history
  router.delete('/history*', function (req, res, next) {
    // DELETE history/historic-process-instances/{processInstanceId}
    
    var queryParameters = req.url.split('history')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    // GET history method need to login, but no specific.
    console.log('================>>> in DELETE /history  queryParameters:', queryParameters);

    // request
    request({
        "method": 'DELETE',
        "url": config.ACTIVITI_REST_API + 'service/history' + queryParameters,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          'content-type': 'application/json'
        },
        json: true
      },
      function (error, response, body) {
        if (!error && response.statusCode >= 200  && response.statusCode <= 204) {
          console.log('Delete /service/history success!');
          res.status(response.statusCode).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });


  });

  router.get('/history*', function (req, res, next) {
    // GET history/historic-process-instances/{processInstanceId}
    // GET history/historic-process-instances
    // GET history/historic-process-instance/{processInstanceId}/identitylinks
    // GET history/historic-process-instances/{processInstanceId}/variables/{variableName}/data
    //
    // GET history/historic-task-instances/{taskId}
    // GET history/historic-task-instances
    // GET history/historic-task-instance/{taskId}/identitylinks
    // GET history/historic-task-instances/{taskId}/variables/{variableName}/data

    var queryParameters = req.url.split('history')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    // GET history method need to login, but no specific.
    console.log('================>>> in GET /history  queryParameters:', queryParameters);

    // request
    request({
        "method": 'GET',
        "url": config.ACTIVITI_REST_API + 'service/history' + queryParameters,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          'content-type': 'application/json'
        },
        json: true
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('Get /service/query/history success!');
          res.status(200).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });


  });
  // Query historic
  router.post('/query/historic*', function (req, res, next) {
    // POST query/historic-process-instances
    // POST query/historic-task-instances

    var queryParameters = req.url.split('/query')[1];
    var processRole = req.role.length > 0 ? req.role[0] : req.anonymousRole;
    // QUERY historic method need to login, but no specific.

    console.log('================>>> in POST /query/historic* queryParameters: ', queryParameters);

    // request
    request({
        "method": 'POST',
        "url": config.ACTIVITI_REST_API + 'service/query' + queryParameters,
        "headers": {
          "Authorization": encodeBase64Auth(processRole.bpmAccount, processRole.bpmPassword),
          "content-type": 'application/json'
        },
        "json": true,
        "body": req.body
      },
      function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('Get service query!');
          res.status(200).send(body).end();
        } else {
          res.status(response.statusCode).send(body).end();
        }
      });
  });

  var cors = require('cors');
  app.use(cors());
  app.use('/activiti', router);


};

