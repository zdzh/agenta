
要求：
1. 通过新增服务的方式完成下面的需求
2. 服务部署方式是 使用 hosting/docker-compose/oss/docker-compose.gh.yml  docker compose部署
3. 不要修改现有服务代码
4. 不要修改现有数据库，如果需要记录其它数据新建数据库和数据库表
5. 要求对agentas侵入最小，只允许小范围修改agentas的前端代码，对后续agentas升级无影响

需求：
1. 实现一个专门的数据同步服务，负责在应用和agentas之间同步prompt数据和配置
2. 支持通过调用应用api拉取prompt数据和配置并保存到agentas中，api获取的数据格式不一定与agentas一致，需要进行转换，考虑支持python脚本转换
3. 支持通过调用应用api将agentas中的数据和配置同步到应用中，api获取的数据格式不一定与agentas一致，需要进行转换，考虑支持python脚本转换
4. 需要区分不同环境的应用，需要与agentas中的环境对应（开发，测试，生产）
5. 从应用同步数据到agentas时，需要重新比对数据是否一致，避免通过其它途径修改prompt导致数据错乱，如果数据不一致，则创建一个对应新版本
6. 支持以列表的方式查看所有prompt当前在各个环境部署的版本，且支持一键重新同步数据
